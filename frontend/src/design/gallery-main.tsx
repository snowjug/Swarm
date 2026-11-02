import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts';
import './index.css';
import './gallery.css';
import { Gallery } from './Gallery';
import { MotionRoot } from './motion';
import { ToastProvider, TooltipProvider } from './ui';

const root = document.getElementById('root');
if (!root) throw new Error('The root element is missing.');

createRoot(root).render(
  <StrictMode>
    <MotionRoot>
      <TooltipProvider>
        <ToastProvider>
          <Gallery />
        </ToastProvider>
      </TooltipProvider>
    </MotionRoot>
  </StrictMode>,
);
