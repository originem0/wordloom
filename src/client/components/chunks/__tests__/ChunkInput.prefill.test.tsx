// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/client/hooks/useChunks", () => ({
  useGenerateChunk: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChunk: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/client/components/auth/AdminOnly", () => ({ AdminOnly: () => null }));

import { ChunkInput } from "../ChunkInput";

function ui(prefill: string, onPrefillConsumed: () => void) {
  return (
    <MemoryRouter>
      <ChunkInput prefill={prefill} onPrefillConsumed={onPrefillConsumed} />
    </MemoryRouter>
  );
}

const box = () => screen.getByLabelText("Candidate chunk");

// The parent holds a "prefill" string (a clicked suggestion or ?prefill=) and
// clears it again once this component reports it consumed.
describe("ChunkInput prefill", () => {
  it("starts from a prefill present at mount and reports it consumed", () => {
    const consumed = vi.fn();
    render(ui("make a difference", consumed));
    expect(box()).toHaveValue("make a difference");
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it("takes over a later prefill, replacing what was typed", () => {
    const consumed = vi.fn();
    const view = render(ui("", consumed));
    fireEvent.change(box(), { target: { value: "half typed" } });
    expect(consumed).not.toHaveBeenCalled();

    view.rerender(ui("in terms of X", consumed));
    expect(box()).toHaveValue("in terms of X");
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  it("leaves the text alone when the parent clears the prefill", () => {
    const consumed = vi.fn();
    const view = render(ui("in terms of X", consumed));
    fireEvent.change(box(), { target: { value: "in terms of cost" } });
    view.rerender(ui("", consumed));
    expect(box()).toHaveValue("in terms of cost");
    expect(consumed).toHaveBeenCalledTimes(1);
  });

  // Otherwise the parent never clears its prefill, and clicking that same
  // suggestion again later is a no-op state update: the chip looks dead.
  it("reports a prefill consumed even when it equals the current text", () => {
    const consumed = vi.fn();
    const view = render(ui("", consumed));
    fireEvent.change(box(), { target: { value: "by and large" } });
    view.rerender(ui("by and large", consumed));
    expect(box()).toHaveValue("by and large");
    expect(consumed).toHaveBeenCalledTimes(1);
  });
});
