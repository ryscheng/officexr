import './assetBase';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { capturePreviewToken } from '@officexr/server/preview-token';
import { appearanceController } from './theme/appearance';

// Before the first API call, so it carries a token the sign-in just handed back.
capturePreviewToken();
// Before the first paint, so a dark-mode user never sees a light flash.
appearanceController();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
