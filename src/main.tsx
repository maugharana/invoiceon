import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast';
import { AuthProvider } from './lib/auth';
import { DataProvider } from './lib/data';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </DataProvider>
  </StrictMode>,
);
