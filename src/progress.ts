/**
 * 单个弱进度提示：一次补全会话只用一个 Zotero.ProgressWindow，
 * 标题栏右侧显示「已完成/总数」，正文只有一行，随进度原地刷新；
 * 最后一条完成后空闲 4 秒自动关闭，期间有新条目则继续累加。
 */

type EnrichState = "pending" | "success" | "skipped" | "failed";

const HEADLINE = "RSS Helper · 补全元数据";
const IDLE_CLOSE_DELAY = 4000;
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
  summarize(text: string): void {
    this.summary = text;
    if (!this.win) return;
    if (!this.finished) {
      if (this.pending.size === 0) this.finish();
      return;
    }
    this.paint("success", text);
  }

  start(id: number, title: string): void {
    if (this.pending.has(id)) return;
    if (this.win && this.win._window?.closed) this.reset();
    this.pending.add(id);
    this.titles.set(id, clipTitle(title));
    this.total += 1;
    if (!this.ensureWindow()) return;
    this.cancelIdleClose();
    this.finished = false;
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
      Zotero.debug(`[rss-helper] progress headline update failed: ${String(error)}`);
    }
    const parts = [`${this.succeeded} 项已${this.verb}`];
    if (this.skipped > 0) parts.push(`${this.skipped} 项未匹配`);
    if (this.failed > 0) parts.push(`${this.failed} 项失败`);
    const state: EnrichState = this.succeeded === 0 && this.failed > 0 ? "failed" : "success";
    this.paint(state, this.summary ?? parts.join(" · "));
    this.scheduleIdleClose();
  }

  private updateHeadline(): void {
    if (!this.win) return;
    const done = this.succeeded + this.skipped + this.failed;
    try {
      this.win.changeHeadline(this.headline, "feed", `${done}/${this.total}`);
    } catch (error) {
      Zotero.debug(`[rss-helper] progress headline update failed: ${String(error)}`);
    }
  }

  private ensureWindow(): any {
    if (this.win) {
      if (this.win._window?.closed) {
        this.win = null;
        this.line = null;
      } else {
        return this.win;
      }
    }
    const ProgressWindow = (Zotero as any).ProgressWindow;
    if (typeof ProgressWindow !== "function") return null;
    try {
      this.win = new ProgressWindow({ closeOnClick: true });
      this.win.changeHeadline(this.headline, "feed", `0/${this.total}`);
      this.line = new this.win.ItemProgress("", `准备${this.verb}…`);
      this.win.show();
      return this.win;
    } catch (error) {
      Zotero.debug(`[rss-helper] progress window creation failed: ${String(error)}`);
      this.win = null;
      this.line = null;
      return null;
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
      Zotero.debug(`[rss-helper] progress line update failed: ${String(error)}`);
    }
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose();
    this.idleTimer = setTimer(() => {
      this.idleTimer = null;
      try {
        this.win?.close();
      } catch {
        // 窗口已被用户关闭时忽略
      }
      this.reset();
    }, IDLE_CLOSE_DELAY);
  }

  private cancelIdleClose(): void {
    clearTimer(this.idleTimer);
    this.idleTimer = null;
  }

  private reset(): void {
    this.cancelIdleClose();
    try {
      this.line?._hbox?.remove?.();
    } catch {}
    try {
      this.win?.close();
    } catch {}
    this.win = null;
    this.line = null;
    this.pending.clear();
    this.titles.clear();
    this.headline = HEADLINE;
    this.verb = "补全";
    this.summary = null;
    this.total = 0;
    this.succeeded = 0;
    this.skipped = 0;
    this.failed = 0;
    this.finished = false;
  }
}

export const enrichmentProgress = new EnrichmentProgress();
