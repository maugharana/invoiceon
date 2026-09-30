import { MAX_PHOTO_BYTES, MAX_THUMB_BYTES, type DesignPhotoInput } from '../../shared/catalogue';

// A phone camera picture is several megabytes; the app only needs a screen sized one. Shrinking here keeps the database small and the
// catalogue quick, and turns every format the browser can read (HEIC from some phones excepted) into a plain JPEG.

const bytesOf = (dataUrl: string) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);

async function draw(bitmap: ImageBitmap, longSide: number, quality: number, limit: number): Promise<string> {
  const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This computer cannot prepare pictures.');
  ctx.fillStyle = '#fff'; // a transparent PNG becomes white, not black, as a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let q = quality;
  let url = canvas.toDataURL('image/jpeg', q);
  while (bytesOf(url) > limit && q > 0.4) {
    q -= 0.1;
    url = canvas.toDataURL('image/jpeg', q);
  }
  if (bytesOf(url) > limit) throw new Error('That picture is too detailed to shrink enough. Try a different one.');
  return url;
}

/** A picked file as the two pictures the app stores: one for the catalogue, one small one for the lists. */
export async function preparePhoto(file: File): Promise<DesignPhotoInput> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP picture.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('That file could not be read as a picture.');
  }
  try {
    return { image: await draw(bitmap, 1000, 0.82, MAX_PHOTO_BYTES), thumb: await draw(bitmap, 240, 0.75, MAX_THUMB_BYTES) };
  } finally {
    bitmap.close();
  }
}
