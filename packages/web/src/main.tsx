import './assetBase';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/tiny5';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import './index.css';
import App from './App';
import { capturePreviewToken } from './previewToken';

// Before the first API call, so it carries a token the sign-in just handed back.
capturePreviewToken();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
