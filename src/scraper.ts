export type ScrapedItem = {
  id: string;
  name: string;
  /** Per-unit price. iHerb shows the qty-multiplied line subtotal in the
   *  cart row; we divide by qty here so downstream code can split units
   *  across carts cleanly. */
  priceUSD: number;
  qty: number;
  /** iHerb part number, e.g. "CGN-01059". */
  pcode?: string;
  /** Numeric product id from the URL, e.g. "71026". Matches the cart-row
   *  checkbox attribute (data-qa-element="checkbox-pid-71026"). */
  pid?: string;
  url?: string;
  imgUrl?: string;
};

/**
 * Selectors for iHerb's cart DOM. iHerb does not publish a stable schema, so
 * these are best-effort and may need tuning against the live page. Each entry
 * is an ordered list of fallback selectors; the first that resolves wins.
 */
export const SELECTORS = {
  cartItem: [
    '[data-qa-element="line-item"]',
    '[data-qa-element="cart-product"]',
    '.cart-product-item',
    '.product-cart-item',
    'li.cart-item',
  ],
  name: [
    '[data-qa-element="product-item-title"]',
    '[data-qa-element="cart-product-name"]',
    'a[href*="/pr/"]',
    '.product-link',
    '.product-name',
  ],
  price: [
    '[data-qa-element="product-item-price"]',
    '[data-qa-element="cart-product-price"]',
    '.product-price',
    '.price',
  ],
  qty: [
    // Native form controls — try first since their .value is the source of truth.
    '[data-qa-element="product-quantity-select"] select',
    'input[name="quantity"]',
    'input[type="number"]',
    '[data-qa-element="cart-quantity"] input',
    // Custom react-select widget — read the wrapper's textContent (the
    // selected value is rendered as a div inside, the inner <input> is empty).
    '[data-qa-element="product-quantity-select"]',
  ],
  image: [
    '[data-qa-element="product-item-image"] img',
    'img.product-image',
    'img',
  ],
  pcode: [
    '[data-qa-element="product-display-name-part-number"]',
  ],
};

export const querySelectorFirst = <T extends Element>(
  root: ParentNode,
  selectors: string[],
): T | null => {
  for (const sel of selectors) {
    const found = root.querySelector(sel);
    if (found) return found as T;
  }
  return null;
};

export const querySelectorAllFirst = (
  root: ParentNode,
  selectors: string[],
): Element[] => {
  for (const sel of selectors) {
    const found = root.querySelectorAll(sel);
    if (found.length > 0) return Array.from(found);
  }
  return [];
};

/**
 * Parse the first numeric value out of a price string. iHerb sometimes shows
 * both a discounted and a struck-through original price inside the same
 * container (e.g. "$5.00$5.56") — we always want the first (discounted) one.
 */
export function parsePrice(text: string): number {
  const match = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

export function parseQty(value: string | null | undefined): number {
  if (!value) return 1;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Extract an iHerb pcode (e.g. "CGN-01059") from text like "Product code: CGN-01059".
 */
export function parsePcode(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/[A-Z]{2,5}-\d{3,}/);
  return m?.[0];
}

/**
 * Extract numeric pid from an iHerb product URL like
 * "https://il.iherb.com/pr/california-gold-nutrition-.../71026".
 */
export function parsePidFromUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/(\d+)(?:\?|#|$)/);
  return m?.[1];
}

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * iHerb's quantity widget can be a native <select>, a native <input>, or
 * a react-select dropdown whose visible value is rendered as text inside
 * a wrapper <div> (the inner <input> has value="" and is just for typeahead).
 */
export function readQtyValue(el: Element | null): string | null {
  if (!el) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
    if (el.value) return el.value;
    // Fall through to textContent — react-select inputs are empty by design.
  }
  const attr = el.getAttribute('value');
  if (attr) return attr;
  return (el.textContent ?? '').trim() || null;
}

/**
 * True if this node is inside a <del> ancestor — iHerb's strikethrough
 * regular-price element on dealed items. We want the discounted price,
 * not the strikethrough original.
 */
function isInsideStrikethrough(node: Node): boolean {
  let cur: Element | null = node.parentElement;
  while (cur) {
    if (cur.tagName === 'DEL') return true;
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Walk text nodes inside a cart row and return the first one shaped like a
 * price, skipping any text inside a <del>. iHerb's cart row puts the per-
 * item price in a <span> with an emotion-generated class (e.g. "css-17rwpsc")
 * that rotates between deploys, so we can't selector it directly.
 * Currency-prefixed text outside <del> is the stable signal.
 */
export function findFirstPriceText(node: Element): string {
  if (typeof document === 'undefined') return '';
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const re = /[$₪€£]\s*\d/;
  let n = walker.nextNode();
  while (n) {
    const text = (n.nodeValue ?? '').trim();
    if (re.test(text) && !isInsideStrikethrough(n)) return text;
    n = walker.nextNode();
  }
  return '';
}

export function scrapeCart(root: ParentNode): ScrapedItem[] {
  const itemNodes = querySelectorAllFirst(root, SELECTORS.cartItem);
  return itemNodes.map((node): ScrapedItem => {
    const nameEl = querySelectorFirst<HTMLAnchorElement>(node, SELECTORS.name);
    const priceEl = querySelectorFirst(node, SELECTORS.price);
    const qtyEl = querySelectorFirst<HTMLElement>(node, SELECTORS.qty);
    const imgEl = querySelectorFirst<HTMLImageElement>(node, SELECTORS.image);
    const pcodeEl = querySelectorFirst(node, SELECTORS.pcode);

    const nameText =
      (nameEl?.getAttribute('aria-label') ?? nameEl?.textContent ?? '').trim();

    const qty = parseQty(readQtyValue(qtyEl));

    // iHerb's per-row price element shows the post-discount line *subtotal*
    // (qty already multiplied in). Verified by summing all `priceShown`
    // values and matching `[data-qa-element="subtotal"]`. Convert to per-unit
    // so the optimizer's qty-splitting math is correct.
    const priceFromSelector = parsePrice(priceEl?.textContent ?? '');
    const lineSubtotal =
      priceFromSelector > 0
        ? priceFromSelector
        : parsePrice(findFirstPriceText(node as Element));
    const priceUSD = qty > 0 ? lineSubtotal / qty : lineSubtotal;

    return {
      id: newId(),
      name: nameText,
      priceUSD,
      qty,
      pcode: parsePcode(pcodeEl?.textContent),
      pid: parsePidFromUrl(nameEl?.href),
      url: nameEl?.href,
      imgUrl: imgEl?.src,
    };
  });
}
