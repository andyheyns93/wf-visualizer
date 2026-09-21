import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Logic Apps Workflow Visualizer',
  version: pkg.version,
  description:
    'Visualizes Azure Logic App workflows as an interactive graph inside Azure DevOps.',
  icons: {
    16: 'src/extension/icons/icon-16.png',
    32: 'src/extension/icons/icon-32.png',
    48: 'src/extension/icons/icon-48.png',
    128: 'src/extension/icons/icon-128.png',
  },
  background: {
    service_worker: 'src/extension/background.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://dev.azure.com/*', 'https://*.visualstudio.com/*'],
      js: ['src/extension/content.tsx'],
      run_at: 'document_idle',
    },
  ],
  host_permissions: ['https://dev.azure.com/*', 'https://*.visualstudio.com/*'],
  permissions: ['storage', 'webRequest'],
  action: {
    default_title: 'Logic Apps Workflow Visualizer',
    default_icon: {
      16: 'src/extension/icons/icon-16.png',
      32: 'src/extension/icons/icon-32.png',
    },
  },
  options_ui: {
    page: 'src/extension/options.html',
    open_in_tab: true,
  },
});
