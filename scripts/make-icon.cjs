// Renders the InvoiceOn logo to build/icon.png (512×512), which electron-builder turns into the Windows .ico.
// Run with:  node_modules\electron\dist\electron.exe scripts\make-icon.cjs
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SIZE = 512;
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#0F6E56"/>
  <path d="M16 7.6v8.4" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
  <path d="M11 11.4a7.9 7.9 0 1 0 10 0" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE, useContentSize: true, transparent: true, frame: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`)}`);
  await new Promise((r) => setTimeout(r, 400));
  let image = await win.webContents.capturePage();
  // On a scaled display the capture is in device pixels; the icon must be exactly 512×512.
  if (image.getSize().width !== SIZE) image = image.resize({ width: SIZE, height: SIZE, quality: 'best' });
  const out = join(__dirname, '..', 'build');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'icon.png'), image.toPNG());

  // Windows icon: an .ico is a small container of images. Building it here (PNG-compressed entries, which Windows Vista and
  // later read natively) means electron-builder doesn't have to download a converter tool to do it.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => image.resize({ width: s, height: s, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(s === 256 ? 0 : s, e); // width (0 means 256)
    header.writeUInt8(s === 256 ? 0 : s, e + 1); // height
    header.writeUInt8(0, e + 2); // palette size
    header.writeUInt8(0, e + 3); // reserved
    header.writeUInt16LE(1, e + 4); // colour planes
    header.writeUInt16LE(32, e + 6); // bits per pixel
    header.writeUInt32LE(pngs[i].length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...pngs]));
  console.log(`wrote build/icon.png ${image.getSize().width}x${image.getSize().height} and build/icon.ico (${sizes.join(', ')})`);
  app.quit();
});
