/**
 * 一次性弱提示：全局最多一个窗口、一行文字，重复调用只更新内容，2.6 秒后自动关闭。
 * 用于翻译、AI 筛选这类单步动作，避免每个条目弹一个窗口。
 */
const TOAST_HEADLINE = "RSS Helper";
const TOAST_CLOSE_DELAY = 2600;

type TimerHandle = ReturnType<typeof setTimeout>;

function setTimer(fn: () => void, ms: number): TimerHandle {
  const win = Zotero.getMainWindow?.();
  return (win ? win.setTimeout(fn, ms) : setTimeout(fn, ms)) as unknown as TimerHandle;
}

function clearTimer(handle: TimerHandle): void {
  const win = Zotero.getMainWindow?.();
  if (win) win.clearTimeout(handle as unknown as number);
  else clearTimeout(handle as unknown as never);
}

type ToastWindow = {
  show(): void;
  close(): void;
  changeHeadline(text: string, icon?: string): void;
  ItemProgress: new (icon: string, text: string) => ToastLine;
  _window?: { closed?: boolean };
};

type ToastLine = {
  setText(text: string): void;
  setItemTypeAndIcon(itemType: string, icon: string): void;
  setProgress?(percent: number): void;
  setError?(): void;
  _hbox?: { remove(): void };
};

class Toast {
  private win: ToastWindow | null = null;
  private line: ToastLine | null = null;
  private timer: TimerHandle | null = null;

  show(text: string, icon = "tick"): void {
    if (this.win && this.win._window?.closed) this.reset();
    if (!this.win) {
      this.win = new (Zotero.ProgressWindow as unknown as new (options?: unknown) => ToastWindow)({
        closeOnClick: true,
      });
      this.win.changeHeadline(TOAST_HEADLINE, "feed");
      this.line = new this.win.ItemProgress("", text);
      this.win.show();
    }
    try {
      this.line?.setText(text);
      this.line?.setItemTypeAndIcon("", icon);
      this.line?.setProgress?.(100);
      if (icon === "cross") this.line?.setError?.();
    } catch (error) {
      Zotero.debug(`[rss-helper] toast update failed: ${String(error)}`);
    }
    this.scheduleClose();
  }

  dispose(): void {
    this.reset();
  }

  private scheduleClose(): void {
    if (this.timer) clearTimer(this.timer);
    this.timer = setTimer(() => {
      this.timer = null;
      this.reset();
    }, TOAST_CLOSE_DELAY);
  }

  private reset(): void {
    if (this.timer) {
      clearTimer(this.timer);
      this.timer = null;
    }
    try {
      this.line?._hbox?.remove();
      this.win?.close();
    } catch {
      // 窗口可能已被用户关掉
    }
    this.win = null;
    this.line = null;
  }
}

export const toast = new Toast();
