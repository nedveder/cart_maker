import { SELECTORS, querySelectorAllFirst } from './scraper';

export type Diagnosis = {
  url: string;
  pageTitle: string;
  itemCount: number;
  matchedCartItemSelector: string | null;
  selectorHits: Record<string, { selector: string; count: number }[]>;
  /** outerHTML of the first matched cart row, truncated. */
  sampleItemHtml: string | null;
  /** Distinct data-qa-element values on the page with counts. */
  dataQaElements: { value: string; count: number }[];
  /** Counts of common cart-row signals to help locate the cart container. */
  signals: {
    inputs: number;
    quantityInputs: number;
    dollarSignTextNodes: number;
    removeButtons: number;
  };
  /** Every text node inside the first cart row containing a digit/currency. */
  firstItemPriceTextNodes: string[];
};

function countTextMatches(root: ParentNode, pattern: RegExp): number {
  if (typeof document === 'undefined') return 0;
  const treeRoot = (root as Element).nodeType ? (root as Node) : document.body;
  const walker = document.createTreeWalker(treeRoot, NodeFilter.SHOW_TEXT);
  let n = 0;
  let node = walker.nextNode();
  while (node) {
    if (pattern.test(node.nodeValue ?? '')) n++;
    node = walker.nextNode();
  }
  return n;
}

function priceTextNodesIn(node: Element): string[] {
  if (typeof document === 'undefined') return [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const out: string[] = [];
  let cur = walker.nextNode();
  while (cur) {
    const t = (cur.nodeValue ?? '').trim();
    if (t && /[\d$₪€£]/.test(t)) {
      const parent = cur.parentElement;
      const tag = parent?.tagName.toLowerCase() ?? '?';
      const cls = parent?.getAttribute('class') ?? '';
      const dq = parent?.getAttribute('data-qa-element') ?? '';
      out.push(
        `<${tag}${cls ? ` class="${cls}"` : ''}${dq ? ` data-qa-element="${dq}"` : ''}> ${t}`,
      );
    }
    cur = walker.nextNode();
  }
  return out;
}

export function diagnoseCart(root: ParentNode = document): Diagnosis {
  const hits = (selectors: string[]) =>
    selectors.map(selector => ({
      selector,
      count: root.querySelectorAll(selector).length,
    }));

  const itemNodes = querySelectorAllFirst(root, SELECTORS.cartItem);
  const matchedSel =
    SELECTORS.cartItem.find(s => root.querySelectorAll(s).length > 0) ?? null;

  const dataQaCounts = new Map<string, number>();
  for (const el of Array.from(root.querySelectorAll('[data-qa-element]'))) {
    const v = el.getAttribute('data-qa-element') ?? '';
    dataQaCounts.set(v, (dataQaCounts.get(v) ?? 0) + 1);
  }
  const dataQaElements = Array.from(dataQaCounts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);

  const url =
    typeof window !== 'undefined' && window.location ? window.location.href : '';
  const pageTitle = typeof document !== 'undefined' ? document.title : '';

  const firstItem = itemNodes[0] ?? null;

  return {
    url,
    pageTitle,
    itemCount: itemNodes.length,
    matchedCartItemSelector: matchedSel,
    selectorHits: {
      cartItem: hits(SELECTORS.cartItem),
      name: hits(SELECTORS.name),
      price: hits(SELECTORS.price),
      qty: hits(SELECTORS.qty),
    },
    sampleItemHtml: firstItem?.outerHTML.slice(0, 2000) ?? null,
    dataQaElements,
    signals: {
      inputs: root.querySelectorAll('input').length,
      quantityInputs: root.querySelectorAll(
        'input[type="number"], input[name*="qty" i], input[name*="quantity" i], input[aria-label*="quantity" i]',
      ).length,
      dollarSignTextNodes: countTextMatches(root, /\$\d/),
      removeButtons: root.querySelectorAll(
        'button[aria-label*="remove" i], button[data-qa-element*="remove" i]',
      ).length,
    },
    firstItemPriceTextNodes: firstItem ? priceTextNodesIn(firstItem) : [],
  };
}
