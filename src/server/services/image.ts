import sharp from "sharp";

export async function compressImage(
  buffer: Buffer,
  _mimeType: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const image = sharp(buffer);
  const metadata = await image.metadata();

  let processed = image;
  if (metadata.width && metadata.width > 1920) {
    processed = processed.resize(1920, undefined, { fit: "inside" });
  }

  const output = await processed.jpeg({ quality: 80 }).toBuffer();
  return { buffer: output, mimeType: "image/jpeg" };
}
