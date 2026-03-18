import sharp from "sharp";

export async function compressImage(
  buffer: Buffer,
  _mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  // Some decoders/mocks may not provide dimensions; still attempt JPEG conversion.
  if (!metadata.width || !metadata.height) {
    const output = await image.jpeg({ quality: 80 }).toBuffer();
    return { buffer: output, mimeType: "image/jpeg" };
  }

  const maxDimension = 4096;
  const maxPixels = 20_000_000;
  const pixels = metadata.width * metadata.height;

  if (pixels > maxPixels ||
      metadata.width > maxDimension ||
      metadata.height > maxDimension) {
    throw new Error("Image is too large");
  }

  let processed = image;
  if (metadata.width && metadata.width > 1920) {
    processed = processed.resize(1920, undefined, { fit: "inside" });
  }

  const output = await processed.jpeg({ quality: 80 }).toBuffer();
  return { buffer: output, mimeType: "image/jpeg" };
}
