import { createRoot } from 'react-dom/client';
import { setNonce } from 'get-nonce';
import { App } from './App';
import './styles.css';

// Radix scroll-lock styles use this per-response nonce under the existing CSP.
const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
if (nonce) setNonce(nonce);
createRoot(document.getElementById('root')!).render(<App />);
