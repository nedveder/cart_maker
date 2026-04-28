import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

// In-memory mock of chrome.storage.local for jsdom-based tests. Cleared
// before each test for isolation. The real Chrome API is async; we match
// that here with Promise-returning methods.
const store = new Map<string, unknown>();

const local = {
  async get(keys?: string | string[] | null): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    if (keys == null) {
      for (const [k, v] of store.entries()) result[k] = v;
      return result;
    }
    const ks = Array.isArray(keys) ? keys : [keys];
    for (const k of ks) {
      if (store.has(k)) result[k] = store.get(k);
    }
    return result;
  },
  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) store.set(k, v);
  },
  async remove(keys: string | string[]): Promise<void> {
    const ks = Array.isArray(keys) ? keys : [keys];
    for (const k of ks) store.delete(k);
  },
  async clear(): Promise<void> {
    store.clear();
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local },
};

beforeEach(() => {
  store.clear();
});
