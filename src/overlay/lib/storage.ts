import { Settings, DEFAULT_SETTINGS } from './types';

const SETTINGS_KEY = 'cart_maker.settings';

/**
 * The overlay reads cart items directly from iHerb's DOM (it lives on the
 * cart page), so we no longer persist items or do popup-handoff. All we
 * persist is the user's preferred thresholds.
 */
export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    const value = stored[SETTINGS_KEY];
    if (value && typeof value === 'object') {
      return { ...DEFAULT_SETTINGS, ...(value as Partial<Settings>) };
    }
  } catch {
    // chrome.storage isn't available in non-extension contexts (tests)
  }
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  } catch {
    // best-effort — non-fatal if persistence fails
  }
}
