import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { captureAttribution } from './attribution';
import { AuthProvider } from './auth';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { I18nProvider } from './i18n';
import './styles.css';

captureAttribution();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err: any) => count < 2 && !(err?.status >= 400 && err?.status < 500),
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);
