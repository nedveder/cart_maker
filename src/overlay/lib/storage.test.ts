import { describe, it, expect } from 'vitest';
import { loadSettings, saveSettings } from './storage';
import { DEFAULT_SETTINGS } from './types';

describe('settings storage', () => {
  it('returns defaults when nothing saved', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips settings', async () => {
    await saveSettings({ taxFreeMaxUSD: 100, freeShippingMinUSD: 50 });
    expect(await loadSettings()).toEqual({
      taxFreeMaxUSD: 100,
      freeShippingMinUSD: 50,
    });
  });

  it('merges partial saved settings with defaults', async () => {
    await chrome.storage.local.set({
      'cart_maker.settings': { taxFreeMaxUSD: 90 },
    });
    expect(await loadSettings()).toEqual({
      taxFreeMaxUSD: 90,
      freeShippingMinUSD: DEFAULT_SETTINGS.freeShippingMinUSD,
    });
  });
});
