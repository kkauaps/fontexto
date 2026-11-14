import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';
import { AppearanceProvider } from './appearance';
import { LocaleProvider } from './i18n';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </AppearanceProvider>
  </StrictMode>,
);
