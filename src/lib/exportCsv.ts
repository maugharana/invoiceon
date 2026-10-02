import { useToast } from '../components/Toast';
import { api, errorMessage } from './api';

/** Saves a CSV. Desktop: a save dialog via the main process. Browser dev mode: a normal file download. */
export function useCsvExport() {
  const toast = useToast();
  return async (fileName: string, content: string, doneMessage = 'File saved') => {
    try {
      if (window.invoiceon) {
        const result = await api.exportSave(fileName, content);
        if (result.saved) toast.success(doneMessage);
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: fileName.endsWith('.json') ? 'application/json' : 'text/csv;charset=utf-8' }));
        Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
}
