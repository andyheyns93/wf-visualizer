/**
 * SPA-aware location change notifier.
 *
 * Azure DevOps navigates via the History API without full page loads. A content script
 * runs in an isolated world, so monkey-patching `history.pushState` does NOT intercept the
 * page's own calls. Polling `location.href` is the reliable cross-world approach; we also
 * listen to popstate/hashchange for immediacy.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let started = false;
let lastHref = '';

function check() {
  if (location.href !== lastHref) {
    lastHref = location.href;
    for (const listener of listeners) listener();
  }
}

function start() {
  if (started) return;
  started = true;
  lastHref = location.href;
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  setInterval(check, 400);
}

/** Subscribe to location changes. Returns an unsubscribe function. */
export function subscribeLocation(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
