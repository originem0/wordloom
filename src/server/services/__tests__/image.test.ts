import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock sharp with a chainable API
const mockMetadata = vi.fn();
const mockResize = vi.fn();
const mockJpeg = vi.fn();
const mockToBuffer = vi.fn();

vi.mock("sharp", () => {
  return {
    default: vi.fn(() => {
      const chain = {
        metadata: mockMetadata,
        resize: mockResize,
        jpeg: mockJpeg,
        toBuffer: mockToBuffer,
      };
      // Each chainable method returns the chain itself
      mockResize.mockReturnValue(chain);
      mockJpeg.mockReturnValue(chain);
      return chain;
    }),
  };
});

// Import after mock is set up
import { compressImage } from "../image.js";

describe("compressImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const output = Buffer.from("compressed");
    mockToBuffer.mockResolvedValue(output);
  });

  it("resizes images wider than 1920px", async () => {
    mockMetadata.mockResolvedValue({ width: 3840, height: 2160 });

    const result = await compressImage(Buffer.from("img"), "image/png");

    expect(mockResize).toHaveBeenCalledWith(1920, undefined, {
      fit: "inside",
    });
    expect(mockJpeg).toHaveBeenCalledWith({ quality: 80 });
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("does not resize images narrower than 1920px", async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });

    await compressImage(Buffer.from("img"), "image/png");

    expect(mockResize).not.toHaveBeenCalled();
  });

  it("does not resize images exactly 1920px wide (> not >=)", async () => {
    mockMetadata.mockResolvedValue({ width: 1920, height: 1080 });

    await compressImage(Buffer.from("img"), "image/png");

    expect(mockResize).not.toHaveBeenCalled();
  });

  it("does not resize when metadata has no width", async () => {
    mockMetadata.mockResolvedValue({});

    await compressImage(Buffer.from("img"), "image/png");

    expect(mockResize).not.toHaveBeenCalled();
  });

  it("always outputs image/jpeg", async () => {
    mockMetadata.mockResolvedValue({ width: 500 });

    const result = await compressImage(Buffer.from("img"), "image/webp");

    expect(result.mimeType).toBe("image/jpeg");
  });
});
