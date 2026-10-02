const MAX_WIDTH = 480;
const MAX_HEIGHT = 240;

/**
 * Turns a chosen image file into a small PNG data URL for the invoice logo. It's downscaled first because the logo is stored
 * with the settings and embedded in every PDF — a 4 MB photo would make each invoice enormous.
 */
export async function logoFromFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error('Choose a PNG, JPEG, WebP or SVG image.');
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is very large. Choose one under 8 MB.');

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file could not be read as an image.'));
      el.src = url;
    });
    // SVGs without a fixed size report 0; treat them as a wide logo.
    const w = img.naturalWidth || MAX_WIDTH;
    const h = img.naturalHeight || MAX_HEIGHT / 2;
    const scale = Math.min(1, MAX_WIDTH / w, MAX_HEIGHT / h);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws an image file no larger than `max` pixels on its long side, as a JPEG data URL. */
function shrink(img: HTMLImageElement, max: number, quality: number): string {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  // JPEG has no transparency, so a photo with a transparent background would turn black without this.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Turns a chosen photo into the two small copies that are kept: one to look at (about 700 pixels) and a thumbnail for lists. Photos
 * live inside the book, so they are shrunk first: a phone photo of several megabytes would make every backup far larger.
 */
export async function photoFromFile(file: File): Promise<{ dataUrl: string; thumbUrl: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > 25 * 1024 * 1024) throw new Error('That photo is very large. Choose one under 25 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file could not be read as an image.'));
      el.src = url;
    });
    let dataUrl = shrink(img, 700, 0.82);
    // A very detailed photo can still come out large: lower the quality until it is a sensible size.
    for (let q = 0.72; dataUrl.length > 300_000 && q > 0.4; q -= 0.1) dataUrl = shrink(img, 700, q);
    return { dataUrl, thumbUrl: shrink(img, 120, 0.7) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
