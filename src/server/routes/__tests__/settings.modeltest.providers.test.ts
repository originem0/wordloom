import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { db } from "../../db/index.js";
import { settings } from "../../db/schema.js";
import { settingRoutes } from "../settings.js";

// Real settings table (in-memory); only the network is replaced. The other two
// test files of this route answer "" for every setting and pass the key in the
// request, so neither can tell which provider's stored key a probe reads. The
// AI Providers page sends a key only while one is being typed: once it is
// saved, the stored one is all a probe has to go on.
type TestResult = {
  ok: boolean;
  error?: { message: string };
  result?: Record<string, unknown>;
};

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function upstream(body: unknown, status = 200) {
  const mock = vi.fn<FetchLike>(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Where the one upstream request went, and which credential it carried. */
function sent(mock: ReturnType<typeof upstream>) {
  expect(mock).toHaveBeenCalledTimes(1);
  const [url, init] = mock.mock.calls[0];
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return { url: String(url), bearer: headers["Authorization"], googleKey: headers["x-goog-api-key"] };
}

const GATEWAY = "https://gw.example.com/v1";
const openaiOnly = { openai_api_key: "sk-openai", openai_base_url: GATEWAY };
const chat = (content: string) => ({ choices: [{ message: { content }, finish_reason: "stop" }] });

async function store(rows: Record<string, string>) {
  await db.insert(settings).values(Object.entries(rows).map(([key, value]) => ({ key, value })));
}

async function run(payload: Record<string, unknown>): Promise<TestResult> {
  const app = new Hono();
  app.route("/settings", settingRoutes);
  const res = await app.request("/settings/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return (await res.json()) as TestResult;
}

beforeEach(async () => {
  await db.delete(settings);
});

afterEach(() => vi.unstubAllGlobals());

describe("with only the OpenAI-compatible side configured", () => {
  beforeEach(() => store(openaiOnly));

  it("lists the gateway's models with the stored key", async () => {
    const fetchMock = upstream({ data: [{ id: "deepseek-chat" }] });
    // As the page sends it once the key is saved: the base URL draft, no key.
    const body = await run({ target: "openaiListModels", baseUrl: GATEWAY });
    expect(body).toMatchObject({ ok: true, result: { models: ["deepseek-chat"] } });
    expect(sent(fetchMock)).toEqual({ url: `${GATEWAY}/models`, bearer: "Bearer sk-openai" });
  });

  it("reads the stored base URL as well when the request names none", async () => {
    const fetchMock = upstream({ data: [] });
    expect((await run({ target: "openaiListModels" })).ok).toBe(true);
    expect(sent(fetchMock).url).toBe(`${GATEWAY}/models`);
  });

  it.each([
    ["cardsModel", '[{"word":"signal","coreMeaning":"信号"}]'],
    ["deepModel", '{"schemaAnalysis":{"coreSchema":"path"},"familyComparison":[],"boundaryTests":[]}'],
    ["utilityModel", "一只红色的风筝悬在安静的田野上。"],
  ])("probes the %s route with the stored key and base URL", async (target, reply) => {
    const fetchMock = upstream(chat(reply));
    const body = await run({ target, provider: "openai", model: "deepseek-chat" });
    expect(body.ok).toBe(true);
    expect(sent(fetchMock)).toEqual({ url: `${GATEWAY}/chat/completions`, bearer: "Bearer sk-openai" });
  });

  it("is not held up by a Gemini base URL that is not a URL", async () => {
    await store({ gemini_base_url: "not a url" });
    upstream({ data: [] });
    expect((await run({ target: "openaiListModels" })).ok).toBe(true);
  });
});

describe("the OpenAI-compatible base URL check", () => {
  it.each([
    ["no key is stored", { openai_base_url: GATEWAY }],
    ["both keys are stored", { ...openaiOnly, gemini_api_key: "g-key" }],
  ])("needs no key and sends none, when %s", async (_what, rows) => {
    await store(rows);
    const fetchMock = upstream({ error: { message: "missing key" } }, 401);
    expect((await run({ target: "openaiBaseUrl" })).ok).toBe(true);
    expect(sent(fetchMock)).toEqual({ url: `${GATEWAY}/models` });
  });
});

describe("a probe that has no key to use", () => {
  it.each([
    ["listing the gateway's models", { target: "openaiListModels", baseUrl: GATEWAY }],
    ["an OpenAI-compatible route", { target: "cardsModel", provider: "openai", model: "m", baseUrl: GATEWAY }],
  ])("names the OpenAI key as the missing one: %s", async (_what, payload) => {
    const fetchMock = upstream({});
    expect((await run(payload)).error?.message).toBe("OpenAI API Key not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["listing Gemini's models", { target: "listModels" }],
    ["a Gemini route", { target: "cardsModel", provider: "gemini", model: "g" }],
  ])("names the Gemini key as the missing one: %s", async (_what, payload) => {
    const fetchMock = upstream({});
    expect((await run(payload)).error?.message).toBe("Gemini API Key not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// The two keys are issued by different companies. A probe that picked up the
// wrong one would be handing it to the other.
describe("a stored key goes to its own provider only", () => {
  it("the Gemini key is not offered to the OpenAI-compatible gateway", async () => {
    await store({ gemini_api_key: "g-key", openai_base_url: GATEWAY });
    const fetchMock = upstream({ data: [] });
    expect((await run({ target: "openaiListModels" })).error?.message).toBe("OpenAI API Key not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the OpenAI key is not offered to Gemini", async () => {
    await store(openaiOnly);
    const fetchMock = upstream({ models: [] });
    expect((await run({ target: "listModels" })).error?.message).toBe("Gemini API Key not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["gemini", "openai"])("requires a new %s key for another origin", async (provider) => {
    await store({ [provider + "_base_url"]: GATEWAY, [provider + "_api_key"]: "previous-key" });
    const mock = upstream({ models: [], data: [] });
    const payload = { target: provider === "gemini" ? "listModels" : "openaiListModels", baseUrl: "https://new.example" };
    expect((await run(payload)).ok).toBe(false);
    expect(mock).not.toHaveBeenCalled();
    expect((await run({ ...payload, apiKey: "new-key" })).ok).toBe(true);
    expect(mock.mock.calls[0][1]?.redirect).toBe("error");
    expect(Object.values(mock.mock.calls[0][1]?.headers ?? {}).join(" ")).not.toContain("previous-key");
  });

  it("derives credentials from the actual probe destination for a conflicting provider field", async () => {
    await store({ ...openaiOnly, gemini_api_key: "g-key" });
    const mock = upstream({ models: [] });
    expect((await run({ target: "listModels", provider: "openai" })).ok).toBe(true);
    expect(sent(mock)).toEqual({ url: "https://generativelanguage.googleapis.com/v1beta/models", googleKey: "g-key" });
  });

  it("with both stored, each probe carries its own", async () => {
    await store({ ...openaiOnly, gemini_api_key: "g-key" });
    const toGateway = upstream({ data: [] });
    await run({ target: "openaiListModels" });
    expect(sent(toGateway)).toEqual({ url: `${GATEWAY}/models`, bearer: "Bearer sk-openai" });

    const toGemini = upstream({ models: [] });
    await run({ target: "listModels" });
    expect(sent(toGemini)).toEqual({
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      googleKey: "g-key",
    });
  });
});
