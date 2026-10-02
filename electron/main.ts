import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApi, invoke, type Host } from './api';
import { applyPendingRestore } from './backup';
import { driveContext, runAutoBackup } from './backupService';
import { openDb } from './db/connection';
import { plainVault, type Vault } from './drive';
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

/** Secrets (the Google client secret and sign-in) are encrypted with the Windows account when it can, otherwise only hidden. */
const vault: Vault = {
  encrypt: (plain) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(plain).toString('base64')}` : plainVault.encrypt(plain)),
  decrypt: (stored) => (stored.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64')) : plainVault.decrypt(stored)),
};

function createHost(getParent: () => BrowserWindow | null, newWindow: () => void): Host {
  return {
    vault,
    async pickSavePath(title, fileName) {
      return chooseSavePath(getParent(), title, fileName, { name: 'InvoiceOn backup', extensions: ['db'] });
    },
    async pickFile(title) {
      const testFile = process.env.INVOICEON_PICK_FILE;
      if (testFile) return testFile;
      const parent = getParent();
      const options = { title, properties: ['openFile' as const], filters: [{ name: 'InvoiceOn backup', extensions: ['db'] }] };
      const chosen = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return chosen.canceled || !chosen.filePaths[0] ? null : chosen.filePaths[0];
    },
    async pickFolder(title) {
      const parent = getParent();
      const options = { title, properties: ['openDirectory' as const, 'createDirectory' as const] };
      const chosen = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return chosen.canceled || !chosen.filePaths[0] ? null : chosen.filePaths[0];
    },
    async restartApp() {
      // Quitting (rather than exiting) lets the book close properly first; the short wait lets this call answer the screen.
      app.relaunch();
      setTimeout(() => app.quit(), 400);
    },
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
    async openWindow() {
      newWindow();
    },
    async saveTextFile(fileName, content) {
      const json = fileName.toLowerCase().endsWith('.json');
      const filePath = await chooseSavePath(getParent(), json ? 'Save GST return file' : 'Save report', fileName, json ? { name: 'JSON (for the GST portal)', extensions: ['json'] } : { name: 'CSV (opens in Excel)', extensions: ['csv'] });
      if (!filePath) return { saved: false };
      try {
        await writeFile(filePath, content, 'utf8');
      } catch (err) {
        throw new UserError(`Couldn't save the file: ${(err as Error).message}`);
      }
      return { saved: true, path: filePath };
    },
    async saveZipFile(fileName, base64) {
      const filePath = await chooseSavePath(getParent(), 'Save export', fileName, { name: 'ZIP file', extensions: ['zip'] });
      if (!filePath) return { saved: false };
      try {
        await writeFile(filePath, Buffer.from(base64, 'base64'));
      } catch (err) {
        throw new UserError(`Couldn't save the file: ${(err as Error).message}`);
      }
      return { saved: true, path: filePath };
    },
    async printDocument(route) {
      const w = await openDocumentWindow(route);
      await new Promise<void>((resolve, reject) => {
        w.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
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
    // A restore that was prepared last time is swapped in now, before the book is opened.
    applyPendingRestore(dataDir);
    const db = openDb(join(dataDir, 'invoiceon.db'));
    // The daily copy here, then (as set up) in the extra folder and Google Drive. A failure is noted on the Data screen, never in the way.
    const autoBackup = () => void runAutoBackup(db, driveContext(dataDir, vault)).catch((err) => console.error('[backup] failed', err));
    autoBackup();
    // The app can stay open for days, so look again every hour; it only acts when a new day has begun.
    const hourly = setInterval(autoBackup, 60 * 60 * 1000);
    app.on('before-quit', () => clearInterval(hourly));
    const api = createApi(db, createHost(() => win, () => createWindow()), dataDir);

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
    const created = new BrowserWindow({
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
    win = created;
    // Several windows can be open on the same book. Dialogs belong to whichever was used last, and Ctrl+Shift+N opens another.
    created.on('focus', () => (win = created));
    created.on('closed', () => {
      if (win === created) win = BrowserWindow.getAllWindows()[0] ?? null;
    });
    created.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'n') {
        event.preventDefault();
        createWindow();
      }
    });
    created.once('ready-to-show', () => created.show());

    // The app is a single local page: block any navigation away from it and send links to the system browser.
    created.webContents.setWindowOpenHandler(({ url }) => {
      // Web links open in the browser; mailto: links open the person's mail program (used by "Share → Email").
      if (/^(https?|mailto):/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    created.webContents.on('will-navigate', (event, url) => {
      if (!DEV_URL || !url.startsWith(DEV_URL)) event.preventDefault();
    });

    if (DEV_URL) void created.loadURL(DEV_URL);
    else void created.loadFile(join(__dirname, '../dist/index.html'));
  }
}
