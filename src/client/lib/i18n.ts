import { useAppStore } from "@/client/store";
import { ApiError } from "./api";

/** Both versions are required at the call site; there is no missing-key
 * fallback that can silently leave one language on an otherwise translated page. */
export function translate(chinese: string, english: string): string {
  return useAppStore.getState().uiLanguage === "en" ? english : chinese;
}

export function useI18n() {
  const language = useAppStore((state) => state.uiLanguage);
  // A stable translator reads the current preference when called, including
  // an async toast that finishes after the user has switched languages.
  return { language, t: translate };
}

export function formatUiDate(value: number | string | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString(useAppStore.getState().uiLanguage === "en" ? "en-US" : "zh-CN", options);
}

/** Localize application/network failures. Upstream diagnostic messages that
 * are not one of these errors remain technical data rather than invented translations. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, readonly [string, string]> = {
      VALIDATION_ERROR: ["请检查填写的内容。", "Please check the entered values."],
      NOT_FOUND: ["这条记录已不存在。", "This item no longer exists."],
      AUTH_NOT_CONFIGURED: ["服务器尚未配置管理员访问。", "Administrator access is not configured."],
      CSRF_BLOCKED: ["请求被拒绝，请刷新页面后重试。", "The request was rejected. Reload the page and try again."],
      AI_BUSY: ["模型服务正忙，请稍后重试。", "The model service is busy. Please try again later."],
      NOT_JUDGED: ["这句话还没有完成判定。", "This sentence has not been judged yet."],
    };
    const message = error.code && messages[error.code];
    if (message) return translate(...message);
    if (error.status === 401) return translate("请先登录管理员账号。", "Please sign in as an administrator.");
    if (error.status === 403) return translate("请求被拒绝。", "The request was rejected.");
    if (error.status === 404) return translate("这条记录已不存在。", "This item no longer exists.");
    if (error.status === 429) return translate("请求过于频繁，请稍后重试。", "Too many requests. Please try again later.");
    if (error.status >= 500) return translate(`服务暂时不可用（HTTP ${error.status}）。`, `The service is temporarily unavailable (HTTP ${error.status}).`);
  }
  if (error instanceof Error) {
    if (/fetch|network|NetworkError/i.test(error.message)) return translate("网络连接失败，请重试。", "The network connection failed. Please try again.");
    return error.message;
  }
  return translate("操作失败，请重试。", "Something went wrong. Please try again.");
}
