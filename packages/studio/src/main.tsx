import './assetBase.ts';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { capturePreviewToken } from '@officexr/server/preview-token';
import App from './App.tsx';
import './styles/globals.css';

// Before the first API call, so it carries a token the sign-in just handed back.
capturePreviewToken();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
