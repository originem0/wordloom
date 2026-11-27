import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

const state = vi.hoisted(() => ({
  text: "Let an idea take shape." as string | null,
  saved: {} as Record<string, string>,
}));
vi.mock("../../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ all: async () => Object.entries(state.saved).map(([key, value]) => ({ key, value })) }) }) }) },
}));
vi.mock("../../services/expressions-talk.js", () => ({ speechText: vi.fn(async () => state.text) }));

import { expressionSpeechRoutes, rimeSettingsRoutes } from "../expressions-speech.js";
import { SpeechError, splitSpeech, synthesizeSpeech } from "../../services/expressions-speech.js";
import { speechText } from "../../services/expressions-talk.js";

const audio = () => new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), { headers: { "Content-Type": "audio/mpeg" } });
const app = new Hono().route("/api/expressions", expressionSpeechRoutes).route("/api/settings/rime", rimeSettingsRoutes);
const post = (body: unknown) => app.request("/api/expressions/speech", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  state.text = "Let an idea take shape.";
  state.saved = { rime_api_key: "test-key", rime_model: "coda", rime_speaker: "astra", rime_speed: "1" };
  vi.mocked(speechText).mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => audio()));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Rime settings", () => {
  it("reads the public English voices for each model without sending credentials", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({
      coda: { eng: ["marlu", "astra", "marlu"], jpn: ["other"] },
      mistv3: { eng: ["summit", "astra"] }, mistv2: { eng: ["legacy"] },
    }));
    const response = await app.request("/api/settings/rime/voices");
    expect(await response.json()).toEqual({ coda: ["astra", "marlu"], mist: ["astra", "summit"] });
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toBeUndefined();
  });

  it.each([undefined, "draft-key"])("previews the draft without saving it or reading a conversation", async (apiKey) => {
    const response = await app.request("/api/settings/rime/preview", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "mist", speaker: "summit", speed: 0.8, apiKey }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://mist.api.rime.ai/");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer " + (apiKey ?? "test-key") });
    expect(JSON.parse(String(init?.body))).toMatchObject({ speaker: "summit", modelId: "mistv3", timeScaleFactor: 1.25 });
    expect(speechText).not.toHaveBeenCalled();
    expect(state.saved.rime_speaker).toBe("astra");
  });
});

describe("click-to-speak", () => {
  it("gets the current masked reply by id and returns private audio", async () => {
    state.text = "We can ____ the problem.";
    const res = await post({ turn: 12 });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Speech-Parts")).toBe("1");
    expect(speechText).toHaveBeenCalledWith(12);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://coda.api.rime.ai/");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key", Accept: "audio/mpeg" });
    expect(JSON.parse(String(init?.body))).toEqual({
      text: "We can   the problem.", speaker: "astra", modelId: "coda", lang: "en", samplingRate: 24000, timeScaleFactor: 1,
    });
    expect((await res.arrayBuffer()).byteLength).toBe(4);
  });

  it("fetches only the requested part of a long reply", async () => {
    state.text = `${"a".repeat(990)}. Another sentence.`;
    const res = await post({ turn: 12, part: 1 });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Speech-Parts")).toBe("2");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).text).toBe("Another sentence.");
  });

  it.each([{}, { turn: 0 }, { turn: -1 }, { turn: "12" }, { turn: 1.5 }, { turn: 12, part: -1 }, { turn: 12, part: 0.5 }, { turn: 12, text: "client text" }])(
    "rejects an invalid request %j before any provider call", async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("returns a fixed validation error for malformed JSON", async () => {
    const res = await app.request("/api/expressions/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not generate speech for a deleted turn, blank reply, or missing part", async () => {
    state.text = null;
    expect((await post({ turn: 12 })).status).toBe(404);
    state.text = "____";
    expect((await post({ turn: 12 })).status).toBe(422);
    state.text = "A short reply.";
    expect((await post({ turn: 12, part: 3 })).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a missing key on the server and makes no provider call", async () => {
    state.saved.rime_api_key = "";
    const res = await post({ turn: 12 });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Speech unavailable", code: "SPEECH_FAILED", reason: "not configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never forwards a provider error body or its credentials", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('private-provider-error test-key', { status: 429 }));
    const res = await post({ turn: 12 });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Speech unavailable", code: "SPEECH_FAILED", reason: "busy" });
  });

  it("refuses JSON returned with an HTTP success code", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"error":"private-provider-error"}', { headers: { "Content-Type": "application/json" } }));
    const res = await post({ turn: 12 });
    expect(res.status).toBe(502);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe("failed");
  });

  it("uses Mist v3 explicitly and translates speaking speed into duration", async () => {
    state.saved.rime_model = "mist";
    state.saved.rime_speed = "0.8";
    await synthesizeSpeech("An idea.");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://mist.api.rime.ai/");
    expect(JSON.parse(String(init?.body))).toMatchObject({ modelId: "mistv3", timeScaleFactor: 1.25 });
  });

  it("stops on the timeout with a fixed reason", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
    vi.mocked(fetch).mockRejectedValue(new Error("private-provider-error"));
    await expect(synthesizeSpeech("An idea.")).rejects.toEqual(new SpeechError("timeout"));
  });
});

describe("speech chunks", () => {
  it("preserves complete sentences when they fit", () => {
    expect(splitSpeech("One thought. Another thought.")).toEqual(["One thought. Another thought."]);
    expect(splitSpeech(`${"a".repeat(990)}. Another sentence.`)).toEqual([`${"a".repeat(990)}.`, "Another sentence."]);
  });

  it("cuts long sentences within the provider limit without splitting Unicode", () => {
    const text = `${"a".repeat(999)}😀${"b".repeat(1000)}`;
    const chunks = splitSpeech(text);
    expect(chunks.every((s) => s.length <= 1000)).toBe(true);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((s) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(s))).toBe(true);
  });
});
