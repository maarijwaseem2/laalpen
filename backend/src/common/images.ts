import sharp from 'sharp';

/**
 * Every uploaded page is re-encoded on the server: turned upright from the EXIF orientation, limited to
 * 2400 px, saved as JPEG — and all metadata (GPS location, phone model, time) is dropped on the way.
 */
export async function normalizePage(input: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  let img = sharp(input, { failOn: 'error', limitInputPixels: 60_000_000 }).rotate();
  img = img.resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await img.jpeg({ quality: 85, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
