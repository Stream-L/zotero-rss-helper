/**
 * 兼容旧调用点的轻量提示入口：全部转交给全局唯一的 progress 窗，
 * 不再单独开窗口，避免一次操作冒出好几个提示。
 */
import { enrichmentProgress } from "./progress";

export const toast = {
  show(text: string, icon = "tick"): void {
    enrichmentProgress.notice(text, icon);
  },
  dispose(): void {
    // 窗口生命周期统一由 progress 管理，这里无需额外清理
  },
};
