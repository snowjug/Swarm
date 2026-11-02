import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/fonts';
import './design/index.css';
import Root from './app/Root';
import { ErrorBoundary } from './app/ErrorBoundary';

const root = document.getElementById('root');
if (!root) throw new Error('The application root element is missing.');

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
