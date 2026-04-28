/**
 * Pure library for driving iHerb's per-line-item checkboxes to a desired
 * selection. The runtime entry point lives in inject-main.ts (MAIN world)
 * which provides the ToggleAwaiter that observes iHerb's per-toggle PUT
 * responses (so we can retry on 503 rate-limits).
 *
 * Hard-won notes (verified on the live cart by Claude-in-Chrome):
 *   - iHerb sends PUT /api/Carts/v2/lineitems/toggle per checkbox click.
 *   - Spamming clicks faster than ~250ms gets 503 rate-limit responses
 *     that silently DON'T apply the toggle server-side.
 *   - cb.click() is the right way to drive React; do not mutate .checked.
 *   - Row DOM identity is stable across toggles; re-querying is defensive
 *     but harmless.
 *   - DON'T touch [data-qa-element="cart-select-all"] — it has its own
 *     bulk PUT path with separate semantics.
 */

const CART_CHECKBOX_SELECTOR =
  '[data-qa-element="line-item"] input[data-qa-element^="checkbox-pid-"]';

export const getCartCheckboxes = (root: ParentNode): HTMLInputElement[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>(CART_CHECKBOX_SELECTOR));

export const findCheckboxByPid = (
  root: ParentNode,
  pid: string,
): HTMLInputElement | null =>
  root.querySelector<HTMLInputElement>(
    `[data-qa-element="line-item"] input[data-qa-element="checkbox-pid-${pid}"]`,
  );

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

const pidOf = (cb: Element): string =>
  (cb.getAttribute('data-qa-element') ?? '').replace('checkbox-pid-', '');

/**
 * One of:
 *   - HTTP status code (200 = success, 503 = rate-limited and not applied)
 *   - 0           — XHR aborted; benign, iHerb's SSE will reconcile
 *   - 'timeout'   — no PUT response observed in time; treat as not applied
 *   - 'no-awaiter' — caller didn't supply an awaiter (test mode); assume OK
 */
export type ToggleStatus = number | 'timeout' | 'no-awaiter';

export interface ToggleAwaiter {
  /** Returns a promise that resolves with the status of the next PUT for `pid`. */
  awaitNext(pid: string, timeoutMs: number): Promise<ToggleStatus>;
}

export interface ApplyOptions {
  awaiter?: ToggleAwaiter;
  /** Min delay between successive toggles to stay under iHerb's rate limit. */
  minGapMs?: number;
  /** Backoff after each 503/timeout, in ms. */
  retryBackoffsMs?: number[];
  /** Max time to wait for a single PUT response. */
  toggleTimeoutMs?: number;
  /** Delay before the post-condition reconcile pass. */
  postCheckDelayMs?: number;
}

const DEFAULT_OPTIONS: Required<Omit<ApplyOptions, 'awaiter'>> = {
  minGapMs: 250,
  retryBackoffsMs: [800, 1600, 3200],
  toggleTimeoutMs: 4000,
  postCheckDelayMs: 500,
};

export interface ApplyResult {
  matched: number;
  toggled: number;
  drifted: string[];
  attempts: ToggleAttempt[];
}

export interface ToggleAttempt {
  pid: string;
  before: boolean;
  target: boolean;
  status: ToggleStatus | 'skipped' | 'no-checkbox';
  retries: number;
}

async function clickAndAwaitPut(
  cb: HTMLInputElement,
  pid: string,
  awaiter: ToggleAwaiter | undefined,
  timeoutMs: number,
): Promise<ToggleStatus> {
  const pending = awaiter
    ? awaiter.awaitNext(pid, timeoutMs)
    : Promise.resolve('no-awaiter' as const);
  cb.click();
  return pending;
}

async function toggleWithRetry(
  root: ParentNode,
  pid: string,
  desired: boolean,
  awaiter: ToggleAwaiter | undefined,
  opts: Required<Omit<ApplyOptions, 'awaiter'>>,
): Promise<{ status: ToggleStatus | 'no-checkbox'; retries: number }> {
  for (let attempt = 0; attempt <= opts.retryBackoffsMs.length; attempt++) {
    const cb = findCheckboxByPid(root, pid);
    if (!cb) return { status: 'no-checkbox', retries: attempt };
    if (cb.checked === desired) {
      return { status: attempt === 0 ? 'no-awaiter' : 200, retries: attempt };
    }

    const status = await clickAndAwaitPut(cb, pid, awaiter, opts.toggleTimeoutMs);

    // 200 → applied. 0 → aborted but iHerb's SSE will reconcile (benign).
    // 'no-awaiter' → test mode, assume OK.
    if (status === 200 || status === 0 || status === 'no-awaiter') {
      return { status, retries: attempt };
    }

    // 503 or 'timeout' → not applied. Retry after backoff.
    if (attempt < opts.retryBackoffsMs.length) {
      await sleep(opts.retryBackoffsMs[attempt]);
      continue;
    }
    return { status, retries: attempt };
  }
  return { status: 'timeout', retries: opts.retryBackoffsMs.length };
}

/**
 * Toggle every cart-row checkbox so only `targetPids` are checked. Awaits
 * each toggle's PUT response (if an awaiter is supplied) and retries 503s.
 * After the main pass, does a post-condition sweep that catches any drift
 * (e.g. a 503 we couldn't recover from) and re-toggles those once more.
 */
export async function applySelection(
  root: ParentNode,
  targetPids: Set<string>,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  const opts: Required<Omit<ApplyOptions, 'awaiter'>> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const awaiter = options.awaiter;

  const checkboxes = getCartCheckboxes(root);
  const attempts: ToggleAttempt[] = [];
  let toggled = 0;

  for (const cb of checkboxes) {
    const pid = pidOf(cb);
    const before = cb.checked;
    const target = targetPids.has(pid);

    if (before === target) {
      attempts.push({ pid, before, target, status: 'skipped', retries: 0 });
      continue;
    }

    const { status, retries } = await toggleWithRetry(
      root,
      pid,
      target,
      awaiter,
      opts,
    );
    attempts.push({ pid, before, target, status, retries });
    if (
      status === 200 ||
      status === 0 ||
      status === 'no-awaiter'
    ) {
      toggled++;
    }
    if (opts.minGapMs > 0) await sleep(opts.minGapMs);
  }

  // Post-condition reconcile: any pid still not in the desired state gets
  // one more attempt. This is the safety net for 503s we exhausted retries
  // on, or for rows that were re-rendered out from under us.
  if (opts.postCheckDelayMs > 0) await sleep(opts.postCheckDelayMs);
  const drifted: string[] = [];
  for (const cb of getCartCheckboxes(root)) {
    const pid = pidOf(cb);
    const target = targetPids.has(pid);
    if (cb.checked !== target) {
      const { status } = await toggleWithRetry(
        root,
        pid,
        target,
        awaiter,
        opts,
      );
      const liveCb = findCheckboxByPid(root, pid);
      if (
        !liveCb ||
        liveCb.checked !== target ||
        (status !== 200 && status !== 0 && status !== 'no-awaiter')
      ) {
        drifted.push(pid);
      } else {
        toggled++;
      }
    }
  }

  return { matched: checkboxes.length, toggled, drifted, attempts };
}
