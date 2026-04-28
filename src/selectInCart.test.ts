import { describe, it, expect, vi } from 'vitest';
import {
  applySelection,
  type ToggleAwaiter,
  type ToggleStatus,
} from './selectInCart';

const buildCart = (
  rows: { pid: string; checked: boolean }[],
): {
  root: HTMLElement;
  getCheckbox: (pid: string) => HTMLInputElement;
} => {
  const root = document.createElement('div');
  root.innerHTML = rows
    .map(
      r => `
      <div data-qa-element="line-item">
        <label>
          <input type="checkbox" data-qa-element="checkbox-pid-${r.pid}" ${
            r.checked ? 'checked' : ''
          } />
        </label>
      </div>
    `,
    )
    .join('');
  return {
    root,
    getCheckbox: pid =>
      root.querySelector<HTMLInputElement>(
        `input[data-qa-element="checkbox-pid-${pid}"]`,
      )!,
  };
};

// In jsdom there's no real XHR — tests skip the awaiter (default behavior
// resolves to 'no-awaiter' immediately) and zero out the inter-toggle and
// post-check delays so they don't add wall-clock time.
const FAST = { minGapMs: 0, postCheckDelayMs: 0 };

describe('applySelection', () => {
  it('returns matched=0 when no checkboxes are present', async () => {
    const root = document.createElement('div');
    const result = await applySelection(root, new Set(['1']), FAST);
    expect(result.matched).toBe(0);
    expect(result.toggled).toBe(0);
    expect(result.drifted).toEqual([]);
    expect(result.attempts).toEqual([]);
  });

  it('ignores checkbox-pid checkboxes outside cart line-items', async () => {
    // iHerb has stray `checkbox-pid-*` elements in save-for-later and
    // recommendations sections — those must not be toggled.
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-qa-element="line-item">
        <label>
          <input type="checkbox" data-qa-element="checkbox-pid-111" checked />
        </label>
      </div>
      <div data-qa-element="save-for-later-carousel-wrapper">
        <label>
          <input type="checkbox" data-qa-element="checkbox-pid-999" />
        </label>
      </div>
    `;
    const sflClickSpy = vi.spyOn(
      root.querySelector<HTMLInputElement>(
        '[data-qa-element="save-for-later-carousel-wrapper"] input',
      )!,
      'click',
    );
    const result = await applySelection(root, new Set(['111']), FAST);
    expect(result.matched).toBe(1);
    expect(result.toggled).toBe(0);
    expect(sflClickSpy).not.toHaveBeenCalled();
  });

  it('sets checkbox state to match the target set', async () => {
    const { root, getCheckbox } = buildCart([
      { pid: '111', checked: true },
      { pid: '222', checked: true },
      { pid: '333', checked: false },
    ]);
    const result = await applySelection(root, new Set(['111', '333']), FAST);
    expect(result.matched).toBe(3);
    expect(result.toggled).toBe(2);
    expect(result.drifted).toEqual([]);
    expect(getCheckbox('111').checked).toBe(true);
    expect(getCheckbox('222').checked).toBe(false);
    expect(getCheckbox('333').checked).toBe(true);
  });

  it('fires a click event on each input that needs toggling', async () => {
    const { root, getCheckbox } = buildCart([
      { pid: '111', checked: true },
      { pid: '222', checked: false },
    ]);
    const clicks: string[] = [];
    for (const pid of ['111', '222']) {
      getCheckbox(pid).addEventListener('click', () => clicks.push(pid));
    }
    await applySelection(root, new Set(['222']), FAST);
    expect(clicks.sort()).toEqual(['111', '222']);
  });

  it('leaves all checkboxes alone when state already matches the target', async () => {
    const { root, getCheckbox } = buildCart([
      { pid: '111', checked: true },
      { pid: '222', checked: false },
    ]);
    let fired = 0;
    for (const pid of ['111', '222']) {
      getCheckbox(pid).addEventListener('click', () => fired++);
    }
    const result = await applySelection(root, new Set(['111']), FAST);
    expect(result.matched).toBe(2);
    expect(result.toggled).toBe(0);
    expect(fired).toBe(0);
  });

  it('unchecks every box when target set is empty', async () => {
    const { root, getCheckbox } = buildCart([
      { pid: '111', checked: true },
      { pid: '222', checked: true },
    ]);
    const result = await applySelection(root, new Set(), FAST);
    expect(result.matched).toBe(2);
    expect(result.toggled).toBe(2);
    expect(getCheckbox('111').checked).toBe(false);
    expect(getCheckbox('222').checked).toBe(false);
  });

  it('records per-attempt details including target and before state', async () => {
    const { root } = buildCart([
      { pid: '111', checked: true },
      { pid: '222', checked: false },
    ]);
    const result = await applySelection(root, new Set(['222']), FAST);
    const byPid = Object.fromEntries(result.attempts.map(a => [a.pid, a]));
    expect(byPid['111'].before).toBe(true);
    expect(byPid['111'].target).toBe(false);
    expect(byPid['222'].before).toBe(false);
    expect(byPid['222'].target).toBe(true);
  });

  it('retries after a 503 then reports drift if all attempts fail', async () => {
    const { root, getCheckbox } = buildCart([{ pid: '111', checked: true }]);
    // Awaiter that always reports 503 — simulates iHerb rate-limiting.
    const awaiter: ToggleAwaiter = {
      async awaitNext(): Promise<ToggleStatus> {
        return 503;
      },
    };
    // Suppress the actual click toggling .checked so we keep "drifted".
    const cb = getCheckbox('111');
    vi.spyOn(cb, 'click').mockImplementation(() => {
      /* no-op: simulate 503 — server didn't apply */
    });
    const result = await applySelection(root, new Set(), {
      ...FAST,
      awaiter,
      retryBackoffsMs: [0, 0, 0], // burn through retries instantly
    });
    expect(result.drifted).toEqual(['111']);
  });

  it('treats a 200 PUT response as applied', async () => {
    const { root, getCheckbox } = buildCart([{ pid: '111', checked: true }]);
    const awaiter: ToggleAwaiter = {
      async awaitNext(): Promise<ToggleStatus> {
        return 200;
      },
    };
    const result = await applySelection(root, new Set(), {
      ...FAST,
      awaiter,
    });
    expect(result.toggled).toBe(1);
    expect(result.drifted).toEqual([]);
    expect(getCheckbox('111').checked).toBe(false);
  });

  it('treats an aborted (status 0) PUT as benignly applied', async () => {
    const { root, getCheckbox } = buildCart([{ pid: '111', checked: true }]);
    const awaiter: ToggleAwaiter = {
      async awaitNext(): Promise<ToggleStatus> {
        return 0;
      },
    };
    const result = await applySelection(root, new Set(), {
      ...FAST,
      awaiter,
    });
    expect(result.toggled).toBe(1);
    expect(result.drifted).toEqual([]);
    expect(getCheckbox('111').checked).toBe(false);
  });
});
