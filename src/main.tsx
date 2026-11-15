import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { restoreSession, startAutosave } from './lib/projectIO';
import { preloadAllFonts } from './lib/fonts';
import { player } from './lib/player';
import './styles.css';

// Stop iOS double-tap / pinch zoom from fighting the editor's touch controls.
document.addEventListener('gesturestart', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void restoreSession().then(startAutosave);
// Test/debug hook: open the app with ?debug to inspect the editor state from the console.
if (new URLSearchParams(location.search).has('debug')) {
  void import('./store').then(({ useEditor }) => { Object.assign(window, { __editor: useEditor, __player: player }); });
}
preloadAllFonts(() => player.redraw());
