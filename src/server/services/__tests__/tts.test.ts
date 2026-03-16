import { describe, it, expect } from "vitest";
import { pcmToWav } from "../tts.js";

describe("pcmToWav", () => {
  it("produces a correct 44-byte WAV header for 100-byte PCM input", () => {
    // 100 bytes of PCM data
    const pcm = Buffer.alloc(100, 0xab);
    const pcmBase64 = pcm.toString("base64");

    const wav = pcmToWav(pcmBase64);

    // Total: 44-byte header + 100-byte data
    expect(wav.byteLength).toBe(144);

    // RIFF header
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(4)).toBe(36 + 100); // file size - 8
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");

    // fmt sub-chunk
    expect(wav.toString("ascii", 12, 16)).toBe("fmt ");
    expect(wav.readUInt32LE(16)).toBe(16); // subchunk1 size
    expect(wav.readUInt16LE(20)).toBe(1); // PCM format
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt32LE(24)).toBe(24000); // sample rate
    expect(wav.readUInt32LE(28)).toBe(24000 * 1 * 2); // byte rate
    expect(wav.readUInt16LE(32)).toBe(2); // block align
    expect(wav.readUInt16LE(34)).toBe(16); // bits per sample

    // data sub-chunk
    expect(wav.toString("ascii", 36, 40)).toBe("data");
    expect(wav.readUInt32LE(40)).toBe(100); // data size

    // PCM payload preserved
    expect(wav.subarray(44)).toEqual(pcm);
  });

  it("handles custom parameters (44100Hz, stereo, 24-bit)", () => {
    const pcm = Buffer.alloc(60, 0x00);
    const wav = pcmToWav(pcm.toString("base64"), 44100, 2, 24);

    expect(wav.readUInt16LE(22)).toBe(2); // stereo
    expect(wav.readUInt32LE(24)).toBe(44100); // sample rate
    expect(wav.readUInt32LE(28)).toBe(44100 * 2 * 3); // byte rate = 44100 * 2ch * 3 bytes
    expect(wav.readUInt16LE(32)).toBe(6); // block align = 2ch * 3 bytes
    expect(wav.readUInt16LE(34)).toBe(24); // bits per sample
  });

  it("produces a valid header for empty PCM input", () => {
    const wav = pcmToWav(Buffer.alloc(0).toString("base64"));

    expect(wav.byteLength).toBe(44);
    expect(wav.readUInt32LE(4)).toBe(36); // RIFF size with 0 data
    expect(wav.readUInt32LE(40)).toBe(0); // data size
  });
});
