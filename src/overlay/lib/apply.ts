import { CartItem } from './types';

export type ApplyResult = {
  intended: Record<string, number>;
  actuallyChecked: string[];
  missing: string[];
  extra: string[];
  liveSubtotal: string | null;
  headersCaptured: string[];
  qtyResults: Array<{
    pid: string;
    ok: boolean;
    status: number | string;
    actualQty?: number;
    reason?: string;
  }>;
  applyResult?: unknown;
  applyError?: string | null;
};

const REQUEST_TIMEOUT_MS = 60_000;

const newRequestId = (): string =>
  `cm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Send an "apply this cart" request to the MAIN-world inject-main.ts script,
 * which runs the qty + selection flow against iHerb's APIs and posts back
 * the final state. Communication is via window.postMessage — the two scripts
 * share the page's window object even though they live in separate JS worlds.
 */
export function applyCartSpec(items: CartItem[]): Promise<ApplyResult> {
  const spec: Record<string, number> = {};
  for (const i of items) {
    if (i.pid && i.qty > 0) spec[i.pid] = i.qty;
  }
  const requestId = newRequestId();
  return new Promise<ApplyResult>((resolve, reject) => {
    const handler = (e: MessageEvent): void => {
      const data = e.data as
        | { cart_maker?: string; requestId?: string; result?: ApplyResult; error?: string }
        | null;
      if (
        !data ||
        data.cart_maker !== 'response' ||
        data.requestId !== requestId
      )
        return;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      if (data.error) reject(new Error(data.error));
      else if (data.result) resolve(data.result);
      else reject(new Error('apply: malformed response'));
    };
    window.addEventListener('message', handler);
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('apply: timed out waiting for inject-main response'));
    }, REQUEST_TIMEOUT_MS);
    window.postMessage(
      { cart_maker: 'request', requestId, type: 'apply', spec },
      '*',
    );
  });
}
