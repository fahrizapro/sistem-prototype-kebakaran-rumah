import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { SetupScreen } from './components/SetupScreen';
import { firebaseMissingVars } from './lib/firebase';
import './index.css';

const missing = firebaseMissingVars();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {missing.length > 0 ? <SetupScreen missing={missing} /> : <App />}
  </StrictMode>
);
