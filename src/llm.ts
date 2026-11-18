/**
 * AI 接口层。配置解析顺序：
 * 1. 插件自己保存的 API Key（系统钥匙串加密）；
 * 2. 本机 Zotero GPT 插件（zoterogpt@polygon.org）保存的 key / 接口 / 模型。
 * 这样用户只要装了 Zotero GPT，就不用再填一遍。
 */
import { logEvent } from "./log";
import { API_KEY_PREF, getAbsolutePref, getRawPref, getTextSetting, setRawPref } from "./settings";

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | unknown;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>;
};

export type LlmProfile = {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  source: "rss-helper" | "zoterogpt";
};

export type ToolDefinition = {
  spec: { name: string; description: string; parameters: Record<string, unknown> };
  run: (args: Record<string, unknown>) => Promise<unknown> | unknown;
};

const ZOTEROGPT_SECRET = "extensions.zotero.zoterogpt.secretKey";
const ZOTEROGPT_API = "extensions.zotero.zoterogpt.api";
const ZOTEROGPT_MODEL = "extensions.zotero.zoterogpt.model";
const ZOTEROGPT_SETTINGS = "extensions.zotero.zoterogpt.settings";

/**
 * HTTP 头只能携带 Latin-1 字符。Key 里混进中文、全角符号或从网页复制来的零宽字符时，
 * Zotero 的 Headers.append 会直接抛 ByteString 错误，看起来像「网络失败」，实际是 Key 坏了。
 * 这里只返回位置，不返回字符本身，避免把 Key 写进日志。
 */
export function keyProblem(value: string): string | null {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 255) {
      return `第 ${index + 1} 个字符（U+${code.toString(16).toUpperCase()}）`;
    }
  }
  return null;
}

/** API Key 用系统钥匙串加密后存 prefs，不在 profile 里留明文。 */
export async function saveApiKey(key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) {
    setRawPref(API_KEY_PREF, "");
    return true;
  }
  const problem = keyProblem(trimmed);
  if (problem) {
    logEvent("AI", `refused to save API key: non-ASCII character at ${problem}`);
    return false;
  }
  const keyStore = (Zotero as unknown as { OSKeyStore?: { encrypt?: (value: string) => Promise<string> } }).OSKeyStore;
  if (!keyStore?.encrypt) {
    Zotero.debug("[rss-helper] OSKeyStore unavailable; refusing to store API key in plain text");
    return false;
  }
  try {
    const encrypted = await keyStore.encrypt(trimmed);
    setRawPref(API_KEY_PREF, encrypted);
    return true;
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to encrypt API key: ${String(error)}`);
    return false;
  }
}

export async function loadApiKey(): Promise<string | null> {
  const stored = getRawPref(API_KEY_PREF);
  if (typeof stored !== "string" || !stored) return null;
  // OSKeyStore.decrypt 对未加密的值会原样返回，所以这里始终走 decrypt，兼容手工写入的明文。
  const keyStore = (Zotero as unknown as { OSKeyStore?: { decrypt?: (value: string) => Promise<string> } }).OSKeyStore;
  if (!keyStore?.decrypt) {
    logEvent("AI", "OSKeyStore unavailable; cannot read the saved RSS Helper key");
    return null;
  }
  try {
    const plain = await keyStore.decrypt(stored);
    if (typeof plain === "string" && plain) return plain;
    logEvent("AI", "saved RSS Helper key decrypted to an empty value");
    return null;
  } catch (error) {
    logEvent("AI", `failed to decrypt saved RSS Helper key: ${String(error).slice(0, 200)}`);
    return null;
  }
}

export async function hasApiKey(): Promise<boolean> {
  return Boolean(await loadApiKey());
}

/** Zotero GPT 存的是明文 key，但旧版本可能用 oskv1: 加密，两种都兼容。 */
async function decryptValue(value: string): Promise<string | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("oskv1:")) return trimmed;
  const keyStore = (Zotero as unknown as { OSKeyStore?: { decrypt?: (value: string) => Promise<string> } }).OSKeyStore;
  if (!keyStore?.decrypt) return null;
  try {
    const plain = await keyStore.decrypt(trimmed);
    return typeof plain === "string" && plain ? plain : null;
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to decrypt stored key: ${String(error)}`);
    return null;
  }
}

type ZoteroGptConfig = { api?: string; secretKey?: string; model?: string; temperature?: string | number; maxTokens?: number };

function readZoteroGptEntry(): ZoteroGptConfig | null {
  const raw = getAbsolutePref(ZOTEROGPT_SETTINGS);
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, ZoteroGptConfig>;
    const entries = Object.values(parsed).filter((entry) => entry && typeof entry === "object");
    return entries[0] ?? null;
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to parse Zotero GPT settings: ${String(error)}`);
    return null;
  }
}

/** 把接口地址归一成 chat/completions 端点。Zotero GPT 存的是根地址，不带 /v1。 */
export function chatEndpoint(baseUrl: string): string {
  const base = (baseUrl || "https://api.siliconflow.cn/v1").trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

async function resolveLlmProfile(): Promise<LlmProfile | null> {
  const ownKey = await loadApiKey();
  const ownKeyProblem = ownKey ? keyProblem(ownKey) : null;
  if (ownKey && !ownKeyProblem) {
    logEvent("AI", `using API key saved by RSS Helper (length ${ownKey.length})`);
    return {
      baseUrl: getTextSetting("llmBaseUrl"),
      model: getTextSetting("llmModel"),
      apiKey: ownKey,
      temperature: 0.2,
      maxTokens: 800,
      source: "rss-helper",
    };
  }
  if (ownKey && ownKeyProblem) {
    // 坏 Key 不能当成网络错误：跳过它，继续尝试 Zotero GPT 的配置。
    logEvent("AI", `saved RSS Helper key ignored: non-ASCII character at ${ownKeyProblem}; falling back to Zotero GPT`);
  }
  const entry = readZoteroGptEntry();
  const prefKey = getAbsolutePref(ZOTEROGPT_SECRET);
  const rawKey = String(prefKey ?? entry?.secretKey ?? "");
  logEvent(
    "AI",
    `no usable RSS Helper key; zoterogpt pref=${prefKey ? "present" : "missing"} settings=${entry ? "parsed" : "none"}`,
  );
  const apiKey = await decryptValue(rawKey);
  if (!apiKey) {
    logEvent("AI", "no API key from RSS Helper or Zotero GPT");
    return null;
  }
  const baseUrl = String(getAbsolutePref(ZOTEROGPT_API) ?? entry?.api ?? "");
  const model = String(getAbsolutePref(ZOTEROGPT_MODEL) ?? entry?.model ?? "");
  const temperature = Number(entry?.temperature ?? 0.2);
  const maxTokens = Number(entry?.maxTokens ?? 800);
  const profile: LlmProfile = {
    baseUrl: baseUrl || "https://api.siliconflow.cn",
    model: model || "Qwen/Qwen3-8B",
    apiKey,
    temperature: Number.isFinite(temperature) ? Math.min(Math.max(temperature, 0), 1) : 0.2,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 800,
    source: "zoterogpt",
  };
  logEvent("AI", `using Zotero GPT config: ${profile.model} @ ${profile.baseUrl}`);
  return profile;
}

/** 当前可用的配置；没有则返回 null（设置页、菜单据此给提示）。 */
export async function getLlmProfile(): Promise<LlmProfile | null> {
  return resolveLlmProfile();
}

async function postChat(profile: LlmProfile, body: Record<string, unknown>): Promise<{ content: string; toolCalls: unknown[] }> {
  const keyIssue = keyProblem(profile.apiKey);
  if (keyIssue) {
    logEvent("AI", `request aborted: API key has a non-ASCII character at ${keyIssue}`);
    throw new Error(`API Key 含非 ASCII 字符（${keyIssue}），请重新粘贴纯英文/数字的 Key`);
  }
  let xhr: { response?: unknown; status?: number };
  try {
    xhr = (await Zotero.HTTP.request("POST", chatEndpoint(profile.baseUrl), {
      body: JSON.stringify({ model: profile.model, temperature: profile.temperature, ...body }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${profile.apiKey}`,
      },
      responseType: "json",
      timeout: 60000,
    } as any)) as unknown as { response?: unknown; status?: number };
  } catch (error) {
    // UnexpectedStatusException 的 message 里已经带了响应体；网络错误则只有原因。
    logEvent("AI", `request failed: ${String(error)}`);
    throw new Error(`AI 请求失败：${String(error).slice(0, 300)}`);
  }

  const data = (typeof xhr.response === "string" ? JSON.parse(xhr.response) : xhr.response) as ChatResponse | undefined;
  const message = data?.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (!content.trim() && !toolCalls.length) {
    const bodyText = JSON.stringify(data ?? {}).slice(0, 300);
    logEvent("AI", `empty response (HTTP ${xhr.status ?? "?"}): ${bodyText}`);
    throw new Error(`模型返回为空（HTTP ${xhr.status ?? "?"}）：${bodyText}`);
  }
  return { content, toolCalls };
}

function parseJsonObject(content: string): Record<string, unknown> {
  const text = content.trim();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
      } catch {}
    }
    throw new Error(`模型返回不是合法 JSON：${text.slice(0, 120)}`);
  }
}

/** 纯 JSON 调用，不带工具。response_format 不被支持时自动降级重试一次。 */
export async function chatJSON(system: string, user: string, maxTokens = 512): Promise<Record<string, unknown>> {
  const profile = await resolveLlmProfile();
  if (!profile) throw new Error("未配置 AI 接口");
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];
  try {
    const { content } = await postChat(profile, {
      messages,
      max_tokens: Math.min(maxTokens, profile.maxTokens),
      response_format: { type: "json_object" },
    });
    return parseJsonObject(content);
  } catch (error) {
    logEvent("AI", `json_object request failed, retrying without response_format: ${String(error)}`);
    const { content } = await postChat(profile, {
      messages,
      max_tokens: Math.min(maxTokens, profile.maxTokens),
    });
    return parseJsonObject(content);
  }
}

/**
 * 带工具调用的 JSON 调用：模型可以先查条目详情/库内标签，再给结论。
 * 最多 maxRounds 轮工具；最后一轮强制 JSON 输出（不带 tools）。
 */
export async function chatWithTools(
  system: string,
  user: string,
  tools: ToolDefinition[],
  maxTokens = 600,
  maxRounds = 2,
): Promise<Record<string, unknown>> {
  const profile = await resolveLlmProfile();
  if (!profile) throw new Error("未配置 AI 接口");
  try {
    return await chatWithToolsOnce(profile, system, user, tools, maxTokens, maxRounds);
  } catch (error) {
    // 有些模型/网关不支持 tools 或 tool_choice，整轮失败会让每个条目都失败；
    // 这里退回不带工具的纯 JSON 调用，至少先能筛出结果。
    logEvent("AI", `tool call failed, falling back to plain JSON: ${String(error)}`);
    return await chatJSON(system, user, maxTokens);
  }
}

async function chatWithToolsOnce(
  profile: LlmProfile,
  system: string,
  user: string,
  tools: ToolDefinition[],
  maxTokens: number,
  maxRounds: number,
): Promise<Record<string, unknown>> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const specs = tools.map((tool) => ({ type: "function", function: tool.spec }));
  const budget = Math.min(maxTokens, profile.maxTokens);

  for (let round = 0; round < maxRounds; round += 1) {
    const { content, toolCalls } = await postChat(profile, {
      messages,
      max_tokens: budget,
      tools: specs,
      tool_choice: "auto",
    });
    if (!toolCalls.length) {
      if (content.trim()) return parseJsonObject(content);
      break;
    }
    messages.push({ role: "assistant", content, tool_calls: toolCalls });
    for (const rawCall of toolCalls) {
      const call = rawCall as { id?: string; function?: { name?: string; arguments?: string } };
      const name = call.function?.name ?? "";
      const tool = tools.find((candidate) => candidate.spec.name === name);
      let result: unknown;
      try {
        const args = call.function?.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
        result = tool ? await tool.run(args) : { error: `未知工具：${name}` };
      } catch (error) {
        result = { error: String(error) };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id ?? name,
        content: JSON.stringify(result).slice(0, 8000),
      });
    }
  }

  const { content } = await postChat(profile, {
    messages,
    max_tokens: budget,
    response_format: { type: "json_object" },
  });
  return parseJsonObject(content);
}

/**
 * 设置页的「测试 AI 连接」：发一条极小的请求，把配置来源、模型和失败原因都写进日志。
 * 返回一句可直接显示给用户的中文结果。
 */
export async function testAiConnection(): Promise<{ ok: boolean; message: string }> {
  const profile = await resolveLlmProfile();
  if (!profile) {
    logEvent("AI", "connection test: no profile");
    return { ok: false, message: "未找到 API Key（插件设置和 Zotero GPT 都没有）" };
  }
  const where = profile.source === "rss-helper" ? "插件设置" : "Zotero GPT";
  logEvent("AI", `connection test: ${profile.model} @ ${chatEndpoint(profile.baseUrl)} (${where})`);
  try {
    const { content } = await postChat(profile, {
      messages: [{ role: "user", content: "只回复两个字：可用" }],
      max_tokens: 16,
    });
    const text = content.trim().slice(0, 40) || "(空)";
    logEvent("AI", `connection test ok: ${text}`);
    return { ok: true, message: `连接成功（${where} · ${profile.model}）：${text}` };
  } catch (error) {
    const detail = String(error).slice(0, 200);
    logEvent("AI", `connection test failed: ${detail}`);
    return { ok: false, message: `连接失败：${detail}` };
  }
}
