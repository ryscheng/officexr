import './assetBase';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { capturePreviewToken } from '@officexr/server/preview-token';

// Before the first API call, so it carries a token the sign-in just handed back.
capturePreviewToken();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
