import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteApp } from './remote/RemoteApp';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <RemoteApp />
  </StrictMode>,
);
