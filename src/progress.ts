/**
 * 全局唯一的弱提示窗：
 * - 批量任务（补全 / 翻译 / 筛选）共用一个 Zotero.ProgressWindow，标题栏右侧显示「已完成/总数」，
 *   正文只有一行，随进度原地刷新；
 * - 一次性结果（打标签、清除标记、未安装翻译插件等）也走同一个窗口，不再另开 toast；
 * - 窗口只由本模块关闭：finished 后空闲 4 秒自动关，期间有新任务则继续累加；
 * - 用 closeOnClick: false，避免用户点一下窗口就关掉后我们拿不到通知、以后再也不弹。
 */
import { logEvent } from "./log";

type EnrichState = "pending" | "success" | "skipped" | "failed";

const HEADLINE = "RSS Helper · 补全元数据";
const IDLE_CLOSE_DELAY = 4000;
const NOTICE_CLOSE_DELAY = 3200;
const TITLE_LIMIT = 40;

function clipTitle(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) return "未命名 RSS 条目";
  return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}…` : text;
}

function setTimer(fn: () => void, ms: number): any {
  const win: any = (Zotero as any).getMainWindow?.();
  if (win?.setTimeout) return win.setTimeout(fn, ms);
  return setTimeout(fn, ms);
}

function clearTimer(handle: any): void {
  if (handle === null || handle === undefined) return;
  const win: any = (Zotero as any).getMainWindow?.();
  if (win?.clearTimeout) win.clearTimeout(handle);
  else clearTimeout(handle);
}

class EnrichmentProgress {
  private win: any = null;
  private line: any = null;
  private idleTimer: any = null;
  private readonly pending = new Set<number>();
  private readonly titles = new Map<number, string>();
  private headline = HEADLINE;
  private verb = "补全";
  private summary: string | null = null;
  private summaryState: EnrichState = "success";
  private total = 0;
  private succeeded = 0;
  private skipped = 0;
  private failed = 0;
  private finished = false;

  /** 开始一批新任务：换标题与动词，计数从零开始。 */
  begin(headline: string, verb = "补全"): void {
    this.reset();
    this.headline = headline;
    this.verb = verb;
  }

  /** 全部完成后用自定义汇总替换默认文案（例如 AI 筛选的分级计数）。 */
  summarize(text: string, state: EnrichState = "success"): void {
    this.summary = text;
    this.summaryState = state;
    if (!this.win) return;
    if (!this.finished) {
      if (this.pending.size === 0) this.finish();
      return;
    }
    this.paint(state, text);
    this.scheduleIdleClose(NOTICE_CLOSE_DELAY);
  }

  /**
   * 一次性结果提示。若正在跑批量任务，就排队到汇总里，避免另开窗口；
   * 空闲时开一个短命的提示窗，几秒后自己关。
   */
  notice(text: string, icon = "tick"): void {
    const state: EnrichState = icon === "cross" ? "failed" : icon === "feed-updating" ? "pending" : "success";
    if (this.win && !this.isWindowClosed()) {
      if (!this.finished && this.pending.size > 0) {
        this.summary = text;
        this.summaryState = state;
        return;
      }
      this.finished = true;
      this.paint(state, text);
      this.scheduleIdleClose(state === "pending" ? 8000 : NOTICE_CLOSE_DELAY);
      return;
    }
    this.reset();
    this.headline = "RSS Helper";
    this.finished = true;
    if (!this.openWindow(text)) return;
    this.paint(state, text);
    this.scheduleIdleClose(state === "pending" ? 8000 : NOTICE_CLOSE_DELAY);
  }

  start(id: number, title: string): void {
    if (this.pending.has(id)) return;
    if (this.win && this.isWindowClosed()) this.reset();
    // 上一个提示窗做过一次性 notice（标题是 "RSS Helper"）时，恢复批任务的标题
    if (this.headline === "RSS Helper") this.headline = HEADLINE;
    this.pending.add(id);
    this.titles.set(id, clipTitle(title));
    this.total += 1;
    if (!this.win) {
      if (!this.openWindow(`准备${this.verb}…`)) return;
    }
    this.cancelIdleClose();
    this.finished = false;
    this.summary = null;
    this.updateHeadline();
    this.paint("pending", `${this.verb}中：${this.titles.get(id)}`);
  }

  succeed(id: number): void {
    if (!this.pending.delete(id)) return;
    this.titles.delete(id);
    this.succeeded += 1;
    this.updateHeadline();
    this.settle();
  }

  skip(id: number): void {
    if (!this.pending.delete(id)) return;
    this.titles.delete(id);
    this.skipped += 1;
    this.updateHeadline();
    this.settle();
  }

  fail(id: number): void {
    if (!this.pending.delete(id)) return;
    this.titles.delete(id);
    this.failed += 1;
    this.updateHeadline();
    this.settle();
  }

  dispose(): void {
    this.reset();
  }

  private settle(): void {
    if (this.total === 0) return;
    if (this.pending.size > 0) {
      const latest = Array.from(this.titles.values()).pop();
      if (latest) this.paint("pending", `${this.verb}中：${latest}`);
      return;
    }
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    try {
      this.win?.changeHeadline(this.headline, "feed", `${this.total}/${this.total}`);
    } catch (error) {
      logEvent("progress", `headline update failed: ${String(error)}`);
    }
    const parts = [`${this.succeeded} 项已${this.verb}`];
    if (this.skipped > 0) {
      parts.push(this.verb === "补全" ? `${this.skipped} 项未匹配` : `${this.skipped} 项跳过`);
    }
    if (this.failed > 0) parts.push(`${this.failed} 项失败`);
    const state: EnrichState = this.summaryState ?? (this.succeeded === 0 && this.failed > 0 ? "failed" : "success");
    this.paint(state, this.summary ?? parts.join(" · "));
    this.scheduleIdleClose(IDLE_CLOSE_DELAY);
  }

  private updateHeadline(): void {
    if (!this.win) return;
    const done = this.succeeded + this.skipped + this.failed;
    try {
      this.win.changeHeadline(this.headline, "feed", `${done}/${this.total}`);
    } catch (error) {
      logEvent("progress", `headline update failed: ${String(error)}`);
    }
  }

  /** 拿不到 dialog 的公开引用，只能尽量判断；判断不了就交给 paint 失败兜底。 */
  private isWindowClosed(): boolean {
    const win: any = this.win;
    if (!win) return true;
    const inner = win._window ?? win._progressWindow ?? win.window;
    if (inner && typeof inner === "object" && "closed" in inner) return Boolean(inner.closed);
    return false;
  }

  private openWindow(text: string): boolean {
    const ProgressWindow = (Zotero as any).ProgressWindow;
    if (typeof ProgressWindow !== "function") return false;
    try {
      this.win = new ProgressWindow({ closeOnClick: false });
      this.win.changeHeadline(this.headline, "feed", this.finished ? undefined : `0/${Math.max(1, this.total)}`);
      this.line = new this.win.ItemProgress("", text);
      this.win.show();
      return true;
    } catch (error) {
      logEvent("progress", `window creation failed: ${String(error)}`);
      this.win = null;
      this.line = null;
      return false;
    }
  }

  private paint(state: EnrichState, text: string): void {
    const line = this.line;
    if (!line) return;
    const icon = state === "pending" ? "feed-updating" : state === "success" ? "tick" : state === "skipped" ? "minus-circle" : "cross";
    try {
      line.setText(text);
      line.setItemTypeAndIcon("", icon);
      line.setProgress(100);
      if (state === "failed") line.setError();
    } catch (error) {
      // 窗口已被关掉时调用会静默失败；这里丢掉引用，下次重新开窗
      logEvent("progress", `line update failed: ${String(error)}`);
      this.win = null;
      this.line = null;
      this.cancelIdleClose();
    }
  }

  private scheduleIdleClose(delay = IDLE_CLOSE_DELAY): void {
    this.cancelIdleClose();
    this.idleTimer = setTimer(() => {
      this.idleTimer = null;
      this.closeWindow();
      this.reset();
    }, delay);
  }

  private cancelIdleClose(): void {
    clearTimer(this.idleTimer);
    this.idleTimer = null;
  }

  private closeWindow(): void {
    try {
      this.win?.close();
    } catch {
      // 窗口已被用户关闭时忽略
    }
  }

  private reset(): void {
    this.cancelIdleClose();
    try {
      this.line?._hbox?.remove?.();
    } catch {}
    this.closeWindow();
    this.win = null;
    this.line = null;
    this.pending.clear();
    this.titles.clear();
    this.headline = HEADLINE;
    this.verb = "补全";
    this.summary = null;
    this.summaryState = "success";
    this.total = 0;
    this.succeeded = 0;
    this.skipped = 0;
    this.failed = 0;
    this.finished = false;
  }
}

export const enrichmentProgress = new EnrichmentProgress();
