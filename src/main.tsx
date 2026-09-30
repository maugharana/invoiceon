import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import { AccessProvider } from './lib/access';
import { DataProvider } from './lib/data';
import { LockScreen } from './pages/LockScreen';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessProvider lockedView={(status, refresh) => <LockScreen status={status} onSignedIn={refresh} />}>
      <DataProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </DataProvider>
    </AccessProvider>
  </StrictMode>,
);
