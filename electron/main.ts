import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApi, invoke, type Host } from './api';
import { backupDaily } from './backup';
import { openDb } from './db/connection';
import { UserError } from './services/common';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const webPreferences = { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * PDF and print both render an invoice or proforma with the very same React component the app shows on screen,
 * in a hidden window pointed at the print route — so the paper copy can't drift from the preview.
 */
async function openDocumentWindow(hash: string): Promise<BrowserWindow> {
  const w = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { ...webPreferences, backgroundThrottling: false } });
  try {
    if (DEV_URL) await w.loadURL(`${DEV_URL}#${hash}`);
    else await w.loadFile(join(__dirname, '../dist/index.html'), { hash });
    // The page flags itself once its data and fonts have loaded.
    for (let i = 0; i < 100; i++) {
      if (await w.webContents.executeJavaScript("document.body.dataset.ready === '1'")) return w;
      await sleep(100);
    }
    throw new UserError('The invoice took too long to prepare. Please try again.');
  } catch (err) {
    w.destroy();
    throw err;
  }
}

/**
 * Asks where to save a file. Automated tests can't drive a native dialog, so INVOICEON_EXPORT_DIR lets them name a folder
 * instead. Returns null if the user cancels.
 */
async function chooseSavePath(parent: BrowserWindow | null, title: string, fileName: string, filter: { name: string; extensions: string[] }): Promise<string | null> {
  const testDir = process.env.INVOICEON_EXPORT_DIR;
  if (testDir) return join(testDir, fileName);
  const options = { title, defaultPath: join(app.getPath('documents'), fileName), filters: [filter] };
  const chosen = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  return chosen.canceled || !chosen.filePath ? null : chosen.filePath;
}

function createHost(getParent: () => BrowserWindow | null): Host {
  return {
    async exportDocumentPdf(route, fileName) {
      const filePath = await chooseSavePath(getParent(), 'Save as PDF', fileName, { name: 'PDF', extensions: ['pdf'] });
      if (!filePath) return { saved: false };
      const w = await openDocumentWindow(route);
      try {
        const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
        await writeFile(filePath, pdf);
        return { saved: true, path: filePath };
      } catch (err) {
        if (err instanceof UserError) throw err;
        throw new UserError(`Couldn't save the PDF: ${(err as Error).message}`);
      } finally {
        w.destroy();
      }
    },
    async saveTextFile(fileName, content) {
      const filePath = await chooseSavePath(getParent(), 'Save report', fileName, { name: 'CSV (opens in Excel)', extensions: ['csv'] });
      if (!filePath) return { saved: false };
      try {
        await writeFile(filePath, content, 'utf8');
      } catch (err) {
        throw new UserError(`Couldn't save the file: ${(err as Error).message}`);
      }
      return { saved: true, path: filePath };
    },
    async printDocument(route, pageMm) {
      const w = await openDocumentWindow(route);
      await new Promise<void>((resolve, reject) => {
        // A roll of labels is not A4: give the printer the label's own size (in microns) and no margins.
        const paper = pageMm ? { pageSize: { width: Math.round(pageMm.widthMm * 1000), height: Math.round(pageMm.heightMm * 1000) }, margins: { marginType: 'none' as const } } : {};
        w.webContents.print({ silent: false, printBackground: true, ...paper }, (success, reason) => {
          w.destroy();
          // Closing the dialog without printing isn't an error.
          if (success || /cancel/i.test(reason)) resolve();
          else reject(new UserError(`Printing failed: ${reason}`));
        });
      });
    },
  };
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    const db = openDb(join(dataDir, 'invoiceon.db'));
    backupDaily(db, join(dataDir, 'backups'));
    const api = createApi(db, createHost(() => win), dataDir);

    ipcMain.handle('api', (_event, method: string, args: unknown[]) => invoke(api, method, Array.isArray(args) ? args : []));
    app.on('before-quit', () => db.close());

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  function createWindow(): void {
    win = new BrowserWindow({
      width: 1360,
      height: 860,
      minWidth: 1200,
      minHeight: 700,
      show: false,
      backgroundColor: '#FAFAF7',
      title: 'InvoiceOn',
      // Packaged builds carry the icon inside the .exe; only the dev window needs it pointed out.
      ...(app.isPackaged ? {} : { icon: join(__dirname, '../build/icon.png') }),
      autoHideMenuBar: true,
      webPreferences,
    });
    win.once('ready-to-show', () => win?.show());

    // The app is a single local page: block any navigation away from it and send links to the system browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!DEV_URL || !url.startsWith(DEV_URL)) event.preventDefault();
    });

    if (DEV_URL) void win.loadURL(DEV_URL);
    else void win.loadFile(join(__dirname, '../dist/index.html'));
  }
}
