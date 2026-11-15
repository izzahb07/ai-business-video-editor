import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { restoreSession, startAutosave } from './lib/projectIO';
import { preloadAllFonts } from './lib/fonts';
import { player } from './lib/player';
import { takeLastCrash, TASK_LABEL } from './lib/crashGuard';
import { toast } from './components/Toast';
import './styles.css';

// Stop iOS double-tap / pinch zoom from fighting the editor's touch controls.
document.addEventListener('gesturestart', (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

const crashed = takeLastCrash();
void restoreSession().then(() => {
  startAutosave();
  if (crashed) {
    const what = TASK_LABEL[crashed] ?? crashed;
    const tip = crashed === 'export' ? ' Try 720p or Low bitrate.' : crashed === 'transcribe:on-device' ? ' It will be skipped from now on — connect the AI server (ⓘ) for captions.' : ' It will be skipped next time.';
    toast(`Safari ran out of memory during ${what} and restarted. Your project is safe.${tip}`, 'warn', 12000);
  }
});
// Test/debug hook: open the app with ?debug to inspect the editor state from the console.
if (new URLSearchParams(location.search).has('debug')) {
  void import('./store').then(({ useEditor }) => { Object.assign(window, { __editor: useEditor, __player: player }); });
}
preloadAllFonts(() => player.redraw());
