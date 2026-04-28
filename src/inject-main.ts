/**
 * MAIN-world content script. Runs in the page's own JS context so it can:
 *   - Wrap fetch() AND XMLHttpRequest to observe iHerb's per-toggle PUT
 *     responses (200 = applied, 503 = rate-limited and dropped, 0 = aborted).
 *   - Capture the headers iHerb's React client sends on cart-mutation calls
 *     (Pref, CustomerId, ih-exp-user-id, apiseed) so we can replay them when
 *     issuing our own qty-change PUTs.
 *   - Drive the React-controlled cart checkboxes via cb.click() and survive
 *     React's commit cycle.
 *
 * Trigger: the overlay (ISOLATED-world content script) sends a
 *   { cart_maker: 'request', requestId, type: 'apply', spec: { pid: qty } }
 * message via window.postMessage. We run the toggle pass, then qty PUTs,
 * then a DOM-truth recovery pass, then post the final state back via
 *   { cart_maker: 'response', requestId, result: ApplyResult }.
 */

import {
  applySelection,
  findCheckboxByPid,
  type ToggleAwaiter,
  type ToggleStatus,
} from './selectInCart';

const TOGGLE_URL_RE = /\/api\/Carts\/v2\/lineitems\/toggle\b/;
const QTY_URL = '/api/Carts/v2/lineitem';
const CART_API_RE = /\/api\/Carts\//;
const POLL_INTERVAL_MS = 300;
const MAX_POLL_ATTEMPTS = 30;
const TOGGLE_TIMEOUT_MS = 2000;
const FINAL_SETTLE_MS = 1500;
const RECOVERY_CLICK_GAP_MS = 800;
const QTY_PUT_GAP_MS = 250;
const RETRY_BACKOFFS_MS = [800, 1600, 3200];

// ---------- toggle PUT awaiter ----------------------------------------------

type Resolver = (status: ToggleStatus) => void;
const pendingByPid = new Map<string, Resolver[]>();

const resolveForPid = (pid: string, status: ToggleStatus): void => {
  const queue = pendingByPid.get(pid);
  if (queue && queue.length > 0) {
    const resolver = queue.shift()!;
    resolver(status);
  }
};

const extractTogglePid = (body: unknown): string | null => {
  try {
    const text =
      typeof body === 'string'
        ? body
        : body instanceof URLSearchParams
          ? body.toString()
          : null;
    if (!text) return null;
    const parsed = JSON.parse(text);
    const productId = parsed?.lineItems?.[0]?.productId;
    return productId != null ? String(productId) : null;
  } catch {
    return null;
  }
};

// ---------- header capture --------------------------------------------------

/**
 * iHerb's React client sets a few non-standard headers on every cart
 * mutation. The cart API returns 400 if Pref / CustomerId / ih-exp-user-id /
 * apiseed are missing. We can't get them from cookies; we must observe an
 * outbound cart-API request and copy them.
 */
const REPLAY_HEADER_NAMES = [
  'pref',
  'customerid',
  'ih-exp-user-id',
  'apiseed',
];
const cartHeaders: Record<string, string> = {};

const captureFetchHeaders = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): void => {
  const merged = new Headers();
  if (typeof input !== 'string' && !(input instanceof URL)) {
    input.headers.forEach((v, k) => merged.set(k, v));
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((v, k) => merged.set(k, v));
  }
  for (const name of REPLAY_HEADER_NAMES) {
    const v = merged.get(name);
    if (v) cartHeaders[name] = v;
  }
};

/**
 * XMLHttpRequest exposes no API for reading request headers from outside.
 * We work around that by wrapping setRequestHeader: each call records
 * `name → value` on a per-instance map, which we drain into the module's
 * cartHeaders cache when send() fires for a cart-API URL.
 */
type CmXhr = XMLHttpRequest & {
  __cmUrl?: string;
  __cmHeaders?: Record<string, string>;
};

const origXhrSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function (
  this: XMLHttpRequest,
  name: string,
  value: string,
): void {
  const xhr = this as CmXhr;
  if (!xhr.__cmHeaders) xhr.__cmHeaders = {};
  xhr.__cmHeaders[name.toLowerCase()] = value;
  return origXhrSetRequestHeader.call(this, name, value);
};

const captureXhrHeaders = (xhr: XMLHttpRequest): void => {
  const tracked = (xhr as CmXhr).__cmHeaders ?? {};
  for (const name of REPLAY_HEADER_NAMES) {
    const v = tracked[name];
    if (v) cartHeaders[name] = v;
  }
};

// ---------- fetch / XHR wrappers --------------------------------------------

const origFetch = window.fetch;
window.fetch = function (
  this: typeof window,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET'))
    .toUpperCase();

  if (CART_API_RE.test(url)) captureFetchHeaders(input, init);

  if (method === 'PUT' && TOGGLE_URL_RE.test(url)) {
    const body = init?.body ?? null;
    const pid = extractTogglePid(body);
    const promise = origFetch.call(this, input as RequestInfo, init);
    if (pid) {
      promise.then(
        r => resolveForPid(pid, r.status as ToggleStatus),
        () => resolveForPid(pid, 0),
      );
    }
    return promise;
  }
  return origFetch.call(this, input as RequestInfo, init);
};

const origXhrOpen = XMLHttpRequest.prototype.open;
const origXhrSend = XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  async?: boolean,
  username?: string | null,
  password?: string | null,
): void {
  (this as XMLHttpRequest & { __cmUrl?: string }).__cmUrl = String(url);
  return origXhrOpen.call(this, method, url, async ?? true, username, password);
};

XMLHttpRequest.prototype.send = function (
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
): void {
  const url = (this as CmXhr).__cmUrl;
  // Capture headers from any cart-API XHR — Pref/CustomerId/etc. need to be
  // replayed when we issue our own qty PUTs.
  if (url && CART_API_RE.test(url)) {
    captureXhrHeaders(this);
  }
  // Wire the toggle awaiter for the specific toggle endpoint.
  if (url && TOGGLE_URL_RE.test(url)) {
    const pid = extractTogglePid(body);
    if (pid) {
      const xhr = this;
      const onLoadEnd = () => {
        resolveForPid(pid, xhr.status as ToggleStatus);
        xhr.removeEventListener('loadend', onLoadEnd);
      };
      this.addEventListener('loadend', onLoadEnd);
    }
  }
  return origXhrSend.call(this, body ?? null);
};

const awaiter: ToggleAwaiter = {
  awaitNext(pid, timeoutMs) {
    return new Promise<ToggleStatus>(resolve => {
      const queue = pendingByPid.get(pid) ?? [];
      queue.push(resolve);
      pendingByPid.set(pid, queue);
      setTimeout(() => {
        const q = pendingByPid.get(pid);
        if (q) {
          const idx = q.indexOf(resolve);
          if (idx >= 0) {
            q.splice(idx, 1);
            resolve('timeout');
          }
        }
      }, timeoutMs);
    });
  },
};

// ---------- DOM helpers -----------------------------------------------------

const sleep = (ms: number): Promise<void> =>
  new Promise(r => setTimeout(r, ms));

const readActuallyChecked = (): Set<string> => {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    '[data-qa-element="line-item"] input[data-qa-element^="checkbox-pid-"]',
  );
  const out = new Set<string>();
  for (const cb of Array.from(inputs)) {
    const pid = (cb.getAttribute('data-qa-element') ?? '').replace(
      'checkbox-pid-',
      '',
    );
    if (cb.checked && pid) out.add(pid);
  }
  return out;
};

const readQtyFromDom = (pid: string): number | null => {
  const cb = document.querySelector(
    `[data-qa-element="line-item"] input[data-qa-element="checkbox-pid-${pid}"]`,
  );
  if (!cb) return null;
  const row = cb.closest('[data-qa-element="line-item"]');
  if (!row) return null;
  const sv = row.querySelector('[class*="singleValue"]');
  if (!sv) return null;
  const n = parseInt((sv.textContent ?? '').trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const readLiveSubtotal = (): string | null => {
  const el = document.querySelector('[data-qa-element="subtotal"]');
  return el ? (el.textContent ?? '').trim() : null;
};

const setDifference = <T>(a: Set<T>, b: Set<T>): T[] =>
  [...a].filter(x => !b.has(x));

// ---------- qty PUT ---------------------------------------------------------

type QtyResult = {
  pid: string;
  ok: boolean;
  status: number | 'timeout' | 'skipped';
  actualQty?: number;
  reason?: string;
};

/**
 * PUT /api/Carts/v2/lineitem with { productId, quantity }. Returns the
 * server's actual qty after applying (it silently clamps to stock). Retries
 * 503s with exponential backoff; treats 4xx as fatal-don't-retry.
 *
 * Idempotent: skips the PUT if the row's current qty already matches.
 */
async function setLineQuantity(
  pid: string,
  newQty: number,
): Promise<QtyResult> {
  const productId = parseInt(pid, 10);
  if (!Number.isInteger(productId) || productId <= 0) {
    return { pid, ok: false, status: 'skipped', reason: 'invalid pid' };
  }
  if (!Number.isInteger(newQty) || newQty < 1) {
    // The qty PUT rejects qty:0 with 400. Use a separate remove endpoint
    // for that case (not implemented here).
    return { pid, ok: false, status: 'skipped', reason: 'invalid qty' };
  }
  const currentQty = readQtyFromDom(pid);
  if (currentQty === newQty) {
    return { pid, ok: true, status: 'skipped', actualQty: newQty };
  }

  const body = JSON.stringify({ productId, quantity: newQty });

  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    let res: Response;
    try {
      res = await origFetch.call(window, QTY_URL, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...cartHeaders },
        body,
      });
    } catch (err) {
      if (attempt < RETRY_BACKOFFS_MS.length) {
        await sleep(RETRY_BACKOFFS_MS[attempt]);
        continue;
      }
      return {
        pid,
        ok: false,
        status: 'timeout',
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    if (res.status === 503) {
      if (attempt < RETRY_BACKOFFS_MS.length) {
        await sleep(RETRY_BACKOFFS_MS[attempt]);
        continue;
      }
      return { pid, ok: false, status: 503, reason: 'rate-limited' };
    }

    if (res.status === 200) {
      let actualQty = newQty;
      try {
        const j = await res.clone().json();
        const lineItems = Array.isArray(j?.lineItems) ? j.lineItems : [];
        const li = lineItems.find(
          (x: { productInfo?: { product?: { id?: number; productId?: number } } }) =>
            x?.productInfo?.product?.id === productId ||
            x?.productInfo?.product?.productId === productId,
        );
        if (li && Number.isInteger((li as { quantity?: number }).quantity)) {
          actualQty = (li as { quantity: number }).quantity;
        }
      } catch {
        // body shape changed — accept the requested value as best-effort
      }
      return {
        pid,
        ok: true,
        status: 200,
        actualQty,
        ...(actualQty !== newQty
          ? { reason: `clamped to ${actualQty} (stock cap)` }
          : {}),
      };
    }

    // 4xx — don't retry
    let reason = `http ${res.status}`;
    try {
      const j = await res.json();
      if (typeof j?.applyFailedReason === 'string') reason = j.applyFailedReason;
    } catch {
      // ignore
    }
    return { pid, ok: false, status: res.status, reason };
  }

  return { pid, ok: false, status: 'timeout' };
}

// ---------- recovery pass ---------------------------------------------------

async function recoverDrift(targetPids: Set<string>): Promise<void> {
  await sleep(FINAL_SETTLE_MS);
  let actuallyChecked = readActuallyChecked();
  let missing = setDifference(targetPids, actuallyChecked);
  let extra = setDifference(actuallyChecked, targetPids);
  if (missing.length === 0 && extra.length === 0) return;

  console.warn('[cart_maker] drift detected, recovering:', { missing, extra });

  for (const pid of [...missing, ...extra]) {
    const cb = findCheckboxByPid(document, pid);
    if (cb) {
      cb.click();
      await sleep(RECOVERY_CLICK_GAP_MS);
    }
  }

  await sleep(FINAL_SETTLE_MS);
  actuallyChecked = readActuallyChecked();
  missing = setDifference(targetPids, actuallyChecked);
  extra = setDifference(actuallyChecked, targetPids);
  if (missing.length || extra.length) {
    console.error('[cart_maker] drift persisted after recovery:', {
      missing,
      extra,
    });
  }
}

// ---------- apply flow ------------------------------------------------------

type ApplyReport = {
  intended: Record<string, number>;
  actuallyChecked: string[];
  missing: string[];
  extra: string[];
  liveSubtotal: string | null;
  headersCaptured: string[];
  qtyResults: QtyResult[];
  applyResult: unknown;
  applyError: string | null;
};

async function waitForCartCheckboxes(): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    const visible = document.querySelectorAll(
      '[data-qa-element="line-item"] input[data-qa-element^="checkbox-pid-"]',
    );
    if (visible.length > 0) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function applySpec(spec: Record<string, number>): Promise<ApplyReport> {
  const ready = await waitForCartCheckboxes();
  if (!ready) {
    return {
      intended: spec,
      actuallyChecked: [],
      missing: Object.keys(spec),
      extra: [],
      liveSubtotal: null,
      headersCaptured: Object.keys(cartHeaders),
      qtyResults: [],
      applyResult: null,
      applyError: 'cart checkboxes never appeared (not logged in?)',
    };
  }

  const targetPids = new Set(Object.keys(spec));

  // 1. Selection FIRST so the toggle PUTs seed cartHeaders for the qty pass.
  let applyResult: unknown = null;
  let applyError: unknown = null;
  try {
    applyResult = await applySelection(document, targetPids, {
      awaiter,
      toggleTimeoutMs: TOGGLE_TIMEOUT_MS,
      postCheckDelayMs: 0,
    });
  } catch (err) {
    applyError = err;
  }
  await sleep(300);

  // 2. Qty changes — preserves selection state.
  const qtyResults: QtyResult[] = [];
  if (Object.keys(cartHeaders).length === 0) {
    console.warn(
      '[cart_maker] no cart-API headers captured during the toggle pass — qty PUTs will fail. This means the toggle pass did not fire any PUTs (cart already in target selection). Toggle one row by hand to seed the headers.',
    );
  }
  for (const [pid, qty] of Object.entries(spec)) {
    const r = await setLineQuantity(pid, qty);
    qtyResults.push(r);
    if (r.status !== 'skipped') await sleep(QTY_PUT_GAP_MS);
  }

  // 3. Definitive recovery.
  await recoverDrift(targetPids);
  const actuallyChecked = readActuallyChecked();
  const missing = setDifference(targetPids, actuallyChecked);
  const extra = setDifference(actuallyChecked, targetPids);
  return {
    intended: spec,
    actuallyChecked: [...actuallyChecked].sort(),
    missing,
    extra,
    liveSubtotal: readLiveSubtotal(),
    headersCaptured: Object.keys(cartHeaders),
    qtyResults,
    applyResult,
    applyError: applyError ? String(applyError) : null,
  };
}

// ---------- postMessage bridge to the overlay -------------------------------

type ApplyRequest = {
  cart_maker: 'request';
  requestId: string;
  type: 'apply';
  spec: Record<string, number>;
};

window.addEventListener('message', async (e: MessageEvent) => {
  const data = e.data as Partial<ApplyRequest> | null;
  if (
    !data ||
    data.cart_maker !== 'request' ||
    data.type !== 'apply' ||
    typeof data.requestId !== 'string' ||
    typeof data.spec !== 'object' ||
    data.spec === null
  ) {
    return;
  }
  const requestId = data.requestId;
  try {
    const report = await applySpec(data.spec);
    // Single FINAL log — handy for debugging from the page console without
    // being noisy on the success path.
    console.info(
      '[cart_maker] FINAL\n' + JSON.stringify(report, null, 2),
    );
    window.postMessage(
      { cart_maker: 'response', requestId, result: report },
      '*',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cart_maker] apply failed:', err);
    window.postMessage(
      { cart_maker: 'response', requestId, error: msg },
      '*',
    );
  }
});
