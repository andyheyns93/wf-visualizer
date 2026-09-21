import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import rfCss from '@xyflow/react/dist/style.css?inline';
import baseCss from '../styles.css?inline';
import { ExtensionPanel } from './ExtensionPanel';
import panelCss from './panel.css?inline';

const HOST_ID = 'wf-visualizer-host';

/**
 * Mount the panel inside a shadow root so Azure DevOps styles and ours can't leak into
 * each other. React Flow + our styles are injected as strings into the shadow root.
 */
function mount() {
  if (!document.body || document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = [rfCss, baseCss, panelCss].join('\n');
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'wf-ext-root';
  shadow.appendChild(root);

  createRoot(root).render(
    <StrictMode>
      <ExtensionPanel rootEl={root} />
    </StrictMode>,
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
