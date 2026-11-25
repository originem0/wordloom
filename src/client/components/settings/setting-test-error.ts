import { ApiError } from "@/client/lib/api";
import { errorMessage, translate } from "@/client/lib/i18n";

export type SettingTestResponse = {
  ok: boolean;
  target?: string;
  latencyMs?: number;
  warnings?: string[];
  requestUrl?: string;
  model?: string;
  result?: unknown;
  error?: { message?: string; hint?: string; status?: number; code?: string };
  [key: string]: unknown;
};

const MESSAGES: Record<string, readonly [string, string]> = {
  "OpenAI API Key not configured.": ["尚未设置 OpenAI API 密钥。", "OpenAI API Key not configured."],
  "OpenAI Base URL not configured.": ["尚未设置 OpenAI 基础地址。", "OpenAI Base URL not configured."],
  "No model specified.": ["尚未选择模型。", "No model specified."],
  "Empty response": ["模型返回了空内容。", "The model returned an empty response."],
  "Model returned empty text.": ["模型返回了空内容。", "The model returned an empty response."],
  "Invalid JSON response": ["模型没有返回有效的 JSON。", "The model did not return valid JSON."],
};

/** Keep test results as data. Cached failures can then be rendered again in
 * either language without translating model names or upstream diagnostics. */
export function settingTestError(res: SettingTestResponse): string {
  const error = res.error;
  if (!error?.message) return translate("测试失败", "Test failed");
  const known = MESSAGES[error.message];
  if (known) return translate(known[0], known[1]);
  return errorMessage(error.status == null ? new Error(error.message) : new ApiError(error.message, error.status, error.code));
}
