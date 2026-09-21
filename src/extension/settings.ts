import type { AdoSurface } from './adoContext';

/** Developer overrides for the ADO DOM selectors, per surface (blank = use built-in default). */
export type SelectorOverrides = Partial<Record<AdoSurface, { container?: string; anchor?: string }>>;

/** User-configurable extension settings, stored in `chrome.storage.sync`. */
export interface Settings {
  /**
   * Size the panel to the page's content area (vs the default full-page viewport),
   * configurable per surface — file view and pull request separately.
   */
  matchContentAreaFile: boolean;
  matchContentAreaPr: boolean;
  /** Panel theme. `auto` follows the Azure DevOps page theme. */
  theme: 'auto' | 'light' | 'dark';
  /** Developer: override the ADO DOM selectors used to place the panel/button. */
  devSelectors: SelectorOverrides;
  /**
   * Developer: scramble names and paths shown in the panel (org/project/repo, file path,
   * node names) so screenshots don't leak private information. Display-only.
   */
  scramble: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  matchContentAreaFile: true,
  matchContentAreaPr: false,
  theme: 'auto',
  devSelectors: {},
  scramble: false,
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[KEY] as Partial<Settings> | undefined) };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.sync.set({ [KEY]: { ...current, ...patch } });
}

/** Subscribe to settings changes (e.g. edited on the options page). Returns an unsubscribe. */
export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === 'sync' && changes[KEY]) {
      callback({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings> | undefined) });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
