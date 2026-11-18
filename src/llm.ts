import { API_KEY_PREF, getRawPref, getTextSetting, setRawPref } from "./settings";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

/** API Key 用系统钥匙串加密后存 prefs，不在 profile 里留明文。 */
export async function saveApiKey(key: string): Promise<boolean> {
  const trimmed = key.trim();
  if (!trimmed) {
    setRawPref(API_KEY_PREF, "");
    return true;
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
  const keyStore = (Zotero as unknown as { OSKeyStore?: { decrypt?: (value: string) => Promise<string> } }).OSKeyStore;
  if (!keyStore?.decrypt) return null;
  try {
    const plain = await keyStore.decrypt(stored);
    return typeof plain === "string" && plain ? plain : null;
  } catch (error) {
    Zotero.debug(`[rss-helper] failed to decrypt API key: ${String(error)}`);
    return null;
  }
}

export async function hasApiKey(): Promise<boolean> {
  return Boolean(await loadApiKey());
}

function chatEndpoint(): string {
  return `${getTextSetting("llmBaseUrl").replace(/\/+$/, "")}/chat/completions`;
}

/** 调用 OpenAI 兼容的 chat/completions，要求返回 JSON 对象。 */
export async function chatJSON(system: string, user: string, maxTokens = 512): Promise<Record<string, unknown>> {
  const apiKey = await loadApiKey();
  if (!apiKey) throw new Error("未配置 API Key");

  const payload = {
    model: getTextSetting("llmModel"),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  };

  const xhr = (await Zotero.HTTP.request("POST", chatEndpoint(), {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    responseType: "json",
    timeout: 45000,
  } as any)) as unknown as { response?: unknown; status?: number };

  const data = (typeof xhr.response === "string" ? JSON.parse(xhr.response) : xhr.response) as ChatResponse | undefined;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("模型返回为空");
  return JSON.parse(content) as Record<string, unknown>;
}
