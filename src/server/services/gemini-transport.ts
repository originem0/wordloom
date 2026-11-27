import { GenerateContentResponse } from "@google/genai";
import { readSSE } from "../../shared/sse.js";

export const GEMINI_API_VERSION = "v1beta";

export function buildRequestRoot(baseUrlRaw: string): { requestRoot: string; warnings: string[] } {
  const warnings: string[] = [];
  const trimmed = baseUrlRaw.trim();

  const base = trimmed || "https://generativelanguage.googleapis.com";

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error(
      `Invalid Base URL: "${baseUrlRaw}" (expected something like https://x666.me or leave empty)`
    );
  }

  // Mirror @google/genai behavior: baseUrl + /{apiVersion}
  const normalizedBase = url.toString().replace(/\/+$/, "");
  if (/\/v1(beta)?\/?$/i.test(normalizedBase)) {
    warnings.push(
      `Base URL already ends with /v1 or /v1beta. In WordLoom, Base URL should NOT include the version (otherwise it becomes /v1beta/v1beta).`
    );
  }

  return {
    requestRoot: `${normalizedBase}/${GEMINI_API_VERSION}`,
    warnings,
  };
}

type RequestData = {
  model: string;
  contents: string;
  config: { abortSignal: AbortSignal; responseMimeType?: string; systemInstruction?: string };
};

// The SDK's Models client follows redirects without a public override. Use
// Gemini's two content endpoints so a redirect can never forward x-goog-api-key.
export function geminiTransport(apiKey: string, baseUrl: string) {
  const { requestRoot } = buildRequestRoot(baseUrl);
  async function request({ model, contents, config }: RequestData, stream: boolean) {
    const name = model.replace(/^models\//, "");
    const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const url = `${requestRoot}/models/${encodeURIComponent(name)}:${method}`;
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: config.abortSignal,
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: contents }] }],
        systemInstruction: config.systemInstruction ? { parts: [{ text: config.systemInstruction }] } : undefined,
        generationConfig: config.responseMimeType ? { responseMimeType: config.responseMimeType } : undefined,
      }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null) as { error?: { status?: string; message?: string } } | null;
      const quota = details?.error?.status === "RESOURCE_EXHAUSTED" && /quota|billing|exceeded/i.test(details.error.message ?? "");
      throw new Error(quota ? "Quota exhausted" : `Gemini HTTP ${response.status}`);
    }
    return response;
  }
  return {
    async generateContent(data: RequestData): Promise<GenerateContentResponse> {
      const response = await request(data, false);
      return Object.assign(new GenerateContentResponse(), await response.json());
    },
    async *generateContentStream(data: RequestData): AsyncGenerator<GenerateContentResponse> {
      const response = await request(data, true);
      if (!response.body) throw new Error("Missing response stream");
      for await (const frame of readSSE(response.body)) {
        const part = JSON.parse(frame.data);
        if (part.error) throw new Error("Gemini stream failed");
        yield Object.assign(new GenerateContentResponse(), part);
      }
    },
  };
}
