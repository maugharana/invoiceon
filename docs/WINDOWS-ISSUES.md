# Windows issues when packaging InvoiceOn

Two different errors have appeared on this machine. Neither is a bug in InvoiceOn — both come from Windows security software — and
neither affects `npm run dev`, `npm run demo` or `npm start`, which all work.

## 1. "An Application Control policy has blocked this file"

**When:** starting the packaged `release\win-unpacked\InvoiceOn.exe`.

**What it is.** Windows **Smart App Control** is switched **on** (checked: registry `VerifiedAndReputablePolicyState = 1`). It only lets a
program run if it is **digitally signed by a trusted publisher** or Microsoft's cloud already knows it as safe. `InvoiceOn.exe` is a brand
new, unsigned file that Microsoft has never seen, so it is blocked. Windows records it in *Event Viewer → Applications and Services Logs →
Microsoft → Windows → CodeIntegrity → Operational* as event 3077, "did not meet the Enterprise signing level requirements". The stock
`electron.exe` still runs because it is a widely-known file, which is why `npm run dev` and `npm start` work.

**How to fix it — pick one:**

1. **Use InvoiceOn without the packaged exe (works today).**
   ```bash
   npm run build
   npm start
   ```
   This runs your built app inside the trusted Electron runtime. Good for you on this PC.
2. **Sign the app (the real fix, and needed before selling to anyone).** Buy a **code-signing certificate** (from a certificate authority such
   as DigiCert or Sectigo, roughly US$200–400 a year) or use Microsoft's **Trusted Signing** service. Then electron-builder signs the exe
   during `npm run dist`. Signed apps pass Smart App Control, and the SmartScreen "unknown publisher" warning fades as installs accumulate.
3. **Turn Smart App Control off on this PC** — only if you accept the trade-off. *Windows Security → App & browser control → Smart App
   Control settings → Off.* Read the page carefully first: on most Windows 11 versions turning it off **cannot be undone without reinstalling
   Windows**. It's a security setting, so it's your decision and not something to script.

## 2. "EPERM: operation not permitted, rename …"

**When:** building the installer (`npm run dist`). electron-builder unpacks helper tools into `%LOCALAPPDATA%\electron-builder\Cache`, and
the step that renames the freshly unpacked folder is refused.

**What it is.** Something has the new folder open at the exact moment it is renamed — almost always **antivirus scanning newly created
files**. Checked on this PC: Windows Defender's real-time protection is off, and **Seqrite Endpoint Protection** is the registered antivirus.
Moving the cache to another drive did not help, so it isn't one folder — the scanner is watching everything.

**How to fix it — pick one:**

1. **Exclude the build folders from the antivirus.** In Seqrite (or ask whoever administers it): add exclusions for
   `%LOCALAPPDATA%\electron-builder` and the project's `release` folder, then run `npm run dist` again.
2. **Pause real-time scanning briefly** for the ~1 minute the build takes, then turn it back on.
3. **Build somewhere else.** Building on a clean machine or a CI service (e.g. a GitHub Actions Windows runner) avoids the problem
   entirely, and it is also where code-signing (above) is normally done for releases.

`npm run pack` (an unpacked folder, no installer) already works here. The installer is only needed to hand the app to another computer.
