import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './overlay/App';
import overlayCss from './overlay/styles.css';
import { scrapeCart, ScrapedItem } from './scraper';
import { diagnoseCart, Diagnosis } from './diagnose';

/**
 * ISOLATED-world content script. Two responsibilities:
 *   1. On the popup's "toggle-overlay" message, mount/unmount the planner
 *      React app inside a Shadow-DOM-rooted host attached to document.body.
 *      Shadow DOM keeps iHerb's CSS from leaking into ours and vice versa.
 *   2. Continue handling scrape/diagnose messages from the popup so the
 *      Preview / Diagnose buttons keep working.
 *
 * The qty + selection apply path runs in the MAIN-world inject-main.ts; the
 * overlay UI here calls it via window.postMessage.
 */

const HOST_ID = 'cart-maker-overlay-host';

let mounted: { host: HTMLElement; root: Root } | null = null;

function mountOverlay(): void {
  if (mounted) return;
  const host = document.createElement('div');
  host.id = HOST_ID;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = overlayCss;
  shadow.appendChild(styleEl);
  const container = document.createElement('div');
  shadow.appendChild(container);
  const root = createRoot(container);
  root.render(<App onClose={unmountOverlay} />);
  mounted = { host, root };
}

function unmountOverlay(): void {
  if (!mounted) return;
  mounted.root.unmount();
  mounted.host.remove();
  mounted = null;
}

function toggleOverlay(): boolean {
  if (mounted) {
    unmountOverlay();
    return false;
  }
  mountOverlay();
  return true;
}

type Response =
  | { ok: true; type: 'scrape'; items: ScrapedItem[] }
  | { ok: true; type: 'diagnose'; diagnosis: Diagnosis }
  | { ok: true; type: 'toggle-overlay'; mounted: boolean }
  | { ok: false; error: string };

chrome.runtime.onMessage.addListener(
  (msg, _sender, sendResponse: (r: Response) => void) => {
    try {
      if (msg?.type === 'scrape-cart') {
        sendResponse({ ok: true, type: 'scrape', items: scrapeCart(document) });
        return true;
      }
      if (msg?.type === 'diagnose-cart') {
        sendResponse({
          ok: true,
          type: 'diagnose',
          diagnosis: diagnoseCart(document),
        });
        return true;
      }
      if (msg?.type === 'toggle-overlay') {
        const isMounted = toggleOverlay();
        sendResponse({ ok: true, type: 'toggle-overlay', mounted: isMounted });
        return true;
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
      return true;
    }
    return false;
  },
);

// Suppress an unused-import lint complaint while keeping the symbol available
// for the JSX runtime in some bundlers.
void React;
