// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { SpeechButton } from "../SpeechButton";
import { RimeVoiceSettings } from "../../settings/RimeVoiceSettings";
import { useAppStore } from "@/client/store";

// Node 26 has no localStorage without --localstorage-file. Persistence is not
// under test here; keep only the language preference in this test process.
useAppStore.persist.setOptions({ storage: {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
} });

type Source = { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; buffer: unknown; onended: (() => void) | null };
let contexts: FakeContext[];
class FakeContext {
  destination = {};
  sources: Source[] = [];
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({}));
  constructor() { contexts.push(this); }
  createBufferSource() {
    const source: Source = { start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), buffer: null, onended: null };
    this.sources.push(source);
    return source;
  }
}

const audio = (parts = 1) => new Response(new Uint8Array([0xff, 0xfb]), { headers: { "Content-Type": "audio/mpeg", "X-Speech-Parts": String(parts) } });
beforeEach(() => {
  useAppStore.setState({ uiLanguage: "zh-CN" });
  contexts = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("fetch", vi.fn(async () => audio()));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useAppStore.setState({ uiLanguage: "zh-CN" }); });

function show(children = <SpeechButton turnId={12} />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>);
  return { ...view, client };
}
const click = () => fireEvent.click(screen.getByRole("button", { name: "听语音" }));
const started = () => waitFor(() => expect(contexts[0].sources[0]?.start).toHaveBeenCalled());
const end = (context = contexts[0], part = context.sources.length - 1) => act(() => { context.sources[part].onended?.(); });

it("plays a settings preview using the draft voice, speed and key, and stops it on close", async () => {
  vi.mocked(fetch).mockImplementation(async (path) => path === "/api/settings/rime/voices"
    ? Response.json({ coda: ["astra"], mist: ["summit"] }) : audio());
  const view = show(<RimeVoiceSettings model="mist" speaker="summit" speed="1.2" apiKey="draft-key" hasSavedKey={false} setDraft={vi.fn()} />);
  await screen.findByRole("option", { name: "Summit" });
  fireEvent.click(screen.getByRole("button", { name: "测试并试听" }));
  await started();
  const preview = vi.mocked(fetch).mock.calls.find(([path]) => path === "/api/settings/rime/preview");
  expect(JSON.parse(String(preview?.[1]?.body))).toEqual({ model: "mist", speaker: "summit", speed: 1.2, apiKey: "draft-key" });
  view.unmount();
  expect(contexts[0].sources[0].stop).toHaveBeenCalled();
});

describe("a reply's speech button", () => {
  it("changes the labels of active playback without restarting or stopping it", async () => {
    show();
    click();
    await started();
    act(() => useAppStore.getState().setUiLanguage("en"));
    expect(screen.getByRole("button", { name: "Stop reading" })).toHaveAttribute("aria-pressed", "true");
    expect(contexts).toHaveLength(1);
    expect(contexts[0].sources[0].stop).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop reading" }));
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
    expect(contexts[0].sources[0].stop).toHaveBeenCalledOnce();
  });

  it("translates a speech error that was already visible", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: "SPEECH_FAILED", reason: "not configured" }), { status: 503 }));
    show();
    click();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("朗读还没配好。"));
    act(() => useAppStore.getState().setUiLanguage("en"));
    expect(screen.getByRole("alert")).toHaveTextContent("Speech is not configured yet.");
    expect(screen.getByRole("link", { name: "Open settings" })).toHaveAttribute("href", "/providers");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("makes no audio or network request before a click", () => {
    show();
    expect(fetch).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it("sends only a turn id and returns to idle after the audio ends", async () => {
    show();
    click();
    await started();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toEqual({ turn: 12, part: 0 });
    expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe("include");
    expect(screen.getByRole("button", { name: "停止朗读" })).toHaveAttribute("aria-pressed", "true");
    end();
    await waitFor(() => expect(screen.getByRole("button", { name: "听语音" })).toBeInTheDocument());
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("plays chunks in order and waits for one to end before fetching the next", async () => {
    vi.mocked(fetch).mockImplementation(async () => audio(3));
    show();
    click();
    await started();
    expect(fetch).toHaveBeenCalledTimes(1);
    end();
    await waitFor(() => expect(contexts[0].sources).toHaveLength(2));
    end();
    await waitFor(() => expect(contexts[0].sources).toHaveLength(3));
    end();
    await waitFor(() => expect(screen.getByRole("button", { name: "听语音" })).toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).part)).toEqual([0, 1, 2]);
  });

  it("cancels a waiting request when the user stops", async () => {
    let resolve!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((r) => { resolve = r; }));
    show();
    click();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "停止朗读" }));
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve(audio()); });
    expect(contexts[0].sources).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stops when another reply starts speaking", async () => {
    show(<><div data-testid="first"><SpeechButton turnId={12} /></div><div data-testid="second"><SpeechButton turnId={13} /></div></>);
    fireEvent.click(within(screen.getByTestId("first")).getByRole("button"));
    await started();
    fireEvent.click(within(screen.getByTestId("second")).getByRole("button"));
    await waitFor(() => expect(contexts[1].sources).toHaveLength(1));
    expect(contexts[0].sources[0].stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(within(screen.getByTestId("first")).getByRole("button", { name: "听语音" })).toBeInTheDocument();
  });

  it("cancels and closes the audio context when the turn unmounts", async () => {
    const view = show();
    click();
    await started();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    view.unmount();
    expect(signal?.aborted).toBe(true);
    expect(contexts[0].sources[0].stop).toHaveBeenCalledOnce();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("clears private query data when the API says the session expired", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 401 }));
    const { client } = show();
    client.setQueryData(["expressions"], { privateText: "a thought" });
    client.setQueryData(["settings"], { rime_api_key: "configured" });
    click();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("登录已失效"));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });

  it("links to settings for a missing key without exposing the provider response", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: "SPEECH_FAILED", reason: "not configured", error: "private-provider-error" }), { status: 503 }));
    show();
    click();
    await waitFor(() => expect(screen.getByRole("link", { name: "去设置" })).toHaveAttribute("href", "/providers"));
    expect(document.body.textContent).not.toContain("private-provider-error");
  });

  it("does not request audio while disabled", () => {
    show(<SpeechButton turnId={12} disabled />);
    expect(screen.getByRole("button", { name: "听语音" })).toBeDisabled();
    click();
    expect(fetch).not.toHaveBeenCalled();
  });
});
