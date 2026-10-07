import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { FluentProvider, webLightTheme, Toaster } from '@fluentui/react-components';
import App from './App';
import './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FluentProvider theme={webLightTheme}>
      <BrowserRouter>
        <Toaster position="bottom-end" />
        <App />
      </BrowserRouter>
    </FluentProvider>
  </React.StrictMode>
);