/** A picture ready to keep: one to look at and a tiny one for lists, both small JPEGs. */
export interface PreparedImage {
  image: string;
  thumb: string;
}

const MAX_IMAGE_BYTES = 400_000;
const MAX_THUMB_BYTES = 35_000;

const approxBytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be read as a picture. Try a JPEG or PNG."));
    };
    img.src = url;
  });
}

/** Draws the picture no larger than `longest` pixels and lowers the quality until it fits in `maxBytes`. */
function shrink(img: HTMLImageElement, longest: number, maxBytes: number, startQuality: number): string {
  const scale = Math.min(1, longest / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("This computer couldn't prepare the picture.");
  // A white background, so a transparent PNG doesn't turn black as a JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  let quality = startQuality;
  let out = canvas.toDataURL('image/jpeg', quality);
  while (approxBytes(out) > maxBytes && quality > 0.3) {
    quality -= 0.1;
    out = canvas.toDataURL('image/jpeg', quality);
  }
  if (approxBytes(out) > maxBytes) throw new Error('That picture is too detailed to keep. Try a smaller one.');
  return out;
}

/** Shrinks a photo from the camera or the disk (often several MB) to about 100 KB, and makes its small version. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a picture file (JPEG or PNG).');
  const img = await load(file);
  return { image: shrink(img, 1200, MAX_IMAGE_BYTES, 0.82), thumb: shrink(img, 240, MAX_THUMB_BYTES, 0.7) };
}
