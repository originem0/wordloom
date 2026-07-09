import { describe, it, expect } from "vitest";
import { resolveImageConfig } from "../openai-compat.js";

// Key must follow URL: an image-gateway key sent to the text gateway 401s
// ("Invalid token"), so the pair is resolved together, never cross-matched.
describe("resolveImageConfig", () => {
  const base = {
    imageKey: "sk-image",
    imageUrl: "https://img.example.com/v1",
    openaiKey: "sk-text",
    openaiUrl: "https://text.example.com/v1",
  };

  it("uses the image pair when image_base_url is set", () => {
    expect(resolveImageConfig(base)).toEqual({
      apiKey: "sk-image",
      baseUrl: "https://img.example.com/v1",
    });
  });

  it("borrows the openai key when image_base_url is set but key is blank", () => {
    expect(resolveImageConfig({ ...base, imageKey: "" })).toEqual({
      apiKey: "sk-text",
      baseUrl: "https://img.example.com/v1",
    });
  });

  it("falls back to the full openai pair when image_base_url is blank — ignores image_api_key", () => {
    expect(resolveImageConfig({ ...base, imageUrl: "" })).toEqual({
      apiKey: "sk-text",
      baseUrl: "https://text.example.com/v1",
    });
  });

  it("falls back to the openai pair when both image settings are blank", () => {
    expect(resolveImageConfig({ ...base, imageKey: "", imageUrl: "" })).toEqual({
      apiKey: "sk-text",
      baseUrl: "https://text.example.com/v1",
    });
  });
});
