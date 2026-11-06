import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/fonts';
import './design/index.css';
import Root from './app/Root';
import { ErrorBoundary } from './app/ErrorBoundary';
import { bootEdition } from './public/edition';

const root = document.getElementById('root');
if (!root) throw new Error('The application root element is missing.');

// The API client takes part in the public edition only if the server marked this page as one.
bootEdition();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
