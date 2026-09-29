import { contextBridge, ipcRenderer } from 'electron';
import type { Envelope } from '../shared/api';

// The renderer gets exactly one capability: call a named data-layer method. No Node, no filesystem.
contextBridge.exposeInMainWorld('invoiceon', {
  invoke: (method: string, args: unknown[]): Promise<Envelope> => ipcRenderer.invoke('api', method, args),
});
