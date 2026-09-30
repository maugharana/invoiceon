// The phone view (see electron/mobile.ts): what the settings screen needs to know about it.

export interface MobileStatus {
  /** Whether the owner has switched it on. It is remembered, so it starts again next time the app opens. */
  enabled: boolean;
  /** Whether it is answering right now. */
  running: boolean;
  port: number | null;
  /** Something that stopped it starting, in plain words. */
  error: string | null;
  /** The links to open on a phone on the same Wi-Fi, one per network the computer is on. Each contains the secret. */
  urls: string[];
}
