import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { TimerProvider } from './lib/timer';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <TimerProvider>
        <App />
      </TimerProvider>
    </BrowserRouter>
  </StrictMode>,
);
