import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './hooks/ToastProvider';
import App from './App';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>
);
