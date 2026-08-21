import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { registerServiceWorker } from './pwa/register-sw';
import { APP_RELEASE } from './pwa/release';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('app root is missing');
}

document.documentElement.dataset.appRelease = APP_RELEASE;

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void registerServiceWorker();
