import type { ScrapedItem } from './scraper';
import type { Diagnosis } from './diagnose';

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const overlayBtn = $<HTMLButtonElement>('overlay-btn');
const previewBtn = $<HTMLButtonElement>('preview-btn');
const diagnoseBtn = $<HTMLButtonElement>('diagnose-btn');
const statusEl = $<HTMLDivElement>('status');

const setStatus = (msg: string, kind: 'ok' | 'error' | '' = ''): void => {
  statusEl.textContent = msg;
  statusEl.className = kind;
};

async function getCartTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  if (!tab.url?.includes('iherb.com')) {
    throw new Error('Open your iHerb cart tab first.');
  }
  return tab;
}

async function sendOrInject<T>(tabId: number, message: unknown): Promise<T> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch (err) {
    const text = String(err);
    const isNoReceiver =
      text.includes('Receiving end does not exist') ||
      text.includes('Could not establish connection');
    if (!isNoReceiver) throw err;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  }
}

overlayBtn.addEventListener('click', async () => {
  setStatus('Toggling overlay…');
  overlayBtn.disabled = true;
  try {
    const tab = await getCartTab();
    type Resp =
      | { ok: true; type: 'toggle-overlay'; mounted: boolean }
      | { ok: false; error: string };
    const response = await sendOrInject<Resp>(tab.id!, {
      type: 'toggle-overlay',
    });
    if (!response.ok) throw new Error(response.error);
    setStatus(response.mounted ? 'Planner opened.' : 'Planner closed.', 'ok');
    window.close();
  } catch (err) {
    setStatus(String(err instanceof Error ? err.message : err), 'error');
  } finally {
    overlayBtn.disabled = false;
  }
});

previewBtn.addEventListener('click', async () => {
  setStatus('Scraping…');
  previewBtn.disabled = true;
  try {
    const tab = await getCartTab();
    type Resp =
      | { ok: true; type: 'scrape'; items: ScrapedItem[] }
      | { ok: false; error: string };
    const response = await sendOrInject<Resp>(tab.id!, { type: 'scrape-cart' });
    if (!response.ok) throw new Error(response.error);
    setStatus(`Found ${response.items.length} item(s). See console.`, 'ok');
    console.info('[cart_maker] preview:', response.items);
  } catch (err) {
    setStatus(String(err instanceof Error ? err.message : err), 'error');
  } finally {
    previewBtn.disabled = false;
  }
});

diagnoseBtn.addEventListener('click', async () => {
  setStatus('Diagnosing…');
  diagnoseBtn.disabled = true;
  try {
    const tab = await getCartTab();
    type Resp =
      | { ok: true; type: 'diagnose'; diagnosis: Diagnosis }
      | { ok: false; error: string };
    const response = await sendOrInject<Resp>(tab.id!, {
      type: 'diagnose-cart',
    });
    if (!response.ok) throw new Error(response.error);
    setStatus(
      `Found ${response.diagnosis.itemCount} cart row(s). See console.`,
      'ok',
    );
    console.info('[cart_maker] diagnose:', response.diagnosis);
  } catch (err) {
    setStatus(String(err instanceof Error ? err.message : err), 'error');
  } finally {
    diagnoseBtn.disabled = false;
  }
});
