import { useToast } from '../components/Toast';
import { errorMessage } from './api';

/**
 * Saving a document as a PDF, or printing it. In the desktop app the shell does it. In a plain browser there is no shell to write a file,
 * so the document opens in its own tab where the browser's print dialog (with "Save as PDF") does the job.
 */
export function useDocumentOutput() {
  const toast = useToast();
  const openPrintView = (route: string) => {
    window.open(`${location.origin}${location.pathname}#${route}`, '_blank');
    toast.info('Opened in a new tab: click “Save as PDF / Print” there, then choose “Save as PDF”.');
  };
  return {
    async savePdf(route: string, exportCall: () => Promise<{ saved: boolean }>) {
      if (!window.invoiceon) return openPrintView(route);
      try {
        if ((await exportCall()).saved) toast.success('PDF saved');
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    async print(route: string, printCall: () => Promise<void>) {
      if (!window.invoiceon) return openPrintView(route);
      try {
        await printCall();
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
  };
}
