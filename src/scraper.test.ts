import { describe, it, expect } from 'vitest';
import {
  scrapeCart,
  parsePrice,
  parseQty,
  parsePcode,
  parsePidFromUrl,
  findFirstPriceText,
} from './scraper';

const buildCartHtml = (items: { name: string; price: string; qty: number; href?: string }[]): string => `
  <div>
    ${items
      .map(
        (i, idx) => `
      <div data-qa-element="cart-product" data-index="${idx}">
        <a href="${i.href ?? '/pr/example/' + idx}" data-qa-element="cart-product-name">${i.name}</a>
        <span data-qa-element="cart-product-price">${i.price}</span>
        <input name="quantity" type="number" value="${i.qty}" />
        <img class="product-image" src="https://img.example/${idx}.jpg" />
      </div>
    `,
      )
      .join('')}
  </div>
`;

describe('parsePrice', () => {
  it('parses dollar amounts', () => {
    expect(parsePrice('$12.50')).toBe(12.5);
  });
  it('parses with thousands separators', () => {
    expect(parsePrice('$1,234.56')).toBe(1234.56);
  });
  it('returns 0 for empty text', () => {
    expect(parsePrice('')).toBe(0);
  });
  it('returns 0 for unparsable text', () => {
    expect(parsePrice('free!')).toBe(0);
  });
  it('takes the first price when discounted + strikethrough are concatenated', () => {
    expect(parsePrice('$5.00$5.56')).toBe(5.0);
  });
});

describe('parsePcode', () => {
  it('extracts iHerb part code from full label', () => {
    expect(parsePcode('Product code: CGN-01059')).toBe('CGN-01059');
  });
  it('handles a bare code', () => {
    expect(parsePcode('NOW-00372')).toBe('NOW-00372');
  });
  it('returns undefined for missing or empty input', () => {
    expect(parsePcode('')).toBeUndefined();
    expect(parsePcode(null)).toBeUndefined();
    expect(parsePcode(undefined)).toBeUndefined();
  });
  it('returns undefined when no code-shaped substring is present', () => {
    expect(parsePcode('no code here')).toBeUndefined();
  });
});

describe('parsePidFromUrl', () => {
  it('extracts the trailing numeric segment', () => {
    expect(
      parsePidFromUrl(
        'https://il.iherb.com/pr/california-gold-nutrition-x/71026',
      ),
    ).toBe('71026');
  });
  it('handles trailing query string', () => {
    expect(
      parsePidFromUrl('https://il.iherb.com/pr/foo/64009?ref=cart'),
    ).toBe('64009');
  });
  it('returns undefined for missing input', () => {
    expect(parsePidFromUrl(undefined)).toBeUndefined();
    expect(parsePidFromUrl(null)).toBeUndefined();
    expect(parsePidFromUrl('')).toBeUndefined();
  });
  it('returns undefined when URL has no numeric tail', () => {
    expect(parsePidFromUrl('https://il.iherb.com/pr/foo/abc')).toBeUndefined();
  });
});

describe('parseQty', () => {
  it('parses an integer', () => {
    expect(parseQty('3')).toBe(3);
  });
  it('defaults to 1 for empty', () => {
    expect(parseQty('')).toBe(1);
    expect(parseQty(null)).toBe(1);
    expect(parseQty(undefined)).toBe(1);
  });
  it('defaults to 1 for non-numeric', () => {
    expect(parseQty('abc')).toBe(1);
  });
  it('defaults to 1 for zero or negative', () => {
    expect(parseQty('0')).toBe(1);
    expect(parseQty('-5')).toBe(1);
  });
});

describe('scrapeCart', () => {
  it('returns empty array for empty document', () => {
    const root = document.createElement('div');
    expect(scrapeCart(root)).toEqual([]);
  });

  it('extracts a single cart item, dividing the displayed line subtotal by qty', () => {
    // iHerb shows $8.50 as the line subtotal for qty 2 — i.e., $4.25 per unit.
    const root = document.createElement('div');
    root.innerHTML = buildCartHtml([
      { name: 'Vitamin D3', price: '$8.50', qty: 2, href: 'https://www.iherb.com/pr/x/123' },
    ]);
    const items = scrapeCart(root);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Vitamin D3');
    expect(items[0].priceUSD).toBe(4.25);
    expect(items[0].qty).toBe(2);
    expect(items[0].url).toBe('https://www.iherb.com/pr/x/123');
    expect(items[0].imgUrl).toContain('img.example/0');
  });

  it('extracts multiple cart items as per-unit prices', () => {
    const root = document.createElement('div');
    root.innerHTML = buildCartHtml([
      { name: 'A', price: '$10.00', qty: 1 },
      { name: 'B', price: '$30.00', qty: 3 },     // line $30 / qty 3 → $10/unit
      { name: 'C', price: '$1,200.00', qty: 1 },
    ]);
    const items = scrapeCart(root);
    expect(items).toHaveLength(3);
    expect(items.map(i => i.name)).toEqual(['A', 'B', 'C']);
    expect(items.map(i => i.priceUSD)).toEqual([10, 10, 1200]);
    expect(items.map(i => i.qty)).toEqual([1, 3, 1]);
  });

  it('assigns a unique id to each item', () => {
    const root = document.createElement('div');
    root.innerHTML = buildCartHtml([
      { name: 'A', price: '$1', qty: 1 },
      { name: 'B', price: '$2', qty: 1 },
    ]);
    const items = scrapeCart(root);
    expect(items[0].id).not.toBe(items[1].id);
  });

  it('falls back to alternative selectors when primary not present', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <li class="cart-item">
        <a class="product-link" href="/pr/foo/1">Fallback Item</a>
        <span class="product-price">$11.00</span>
        <input type="number" value="2" />
      </li>
    `;
    const items = scrapeCart(root);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Fallback Item');
    // $11.00 line / qty 2 → $5.50 per unit.
    expect(items[0].priceUSD).toBe(5.5);
    expect(items[0].qty).toBe(2);
  });

  it('parses iHerb cart line-item structure (data-qa-element conventions)', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-qa-element="cart-product-list-wrapper">
        <div data-qa-element="line-item">
          <a data-qa-element="product-item-image"
             href="https://il.iherb.com/pr/foo/71026"
             aria-label="Pure Creatine, 1 lb (454 g)">
            <img src="https://img.example/cre.jpg" alt="Pure Creatine, 1 lb (454 g)" />
          </a>
          <a data-qa-element="product-item-title" href="https://il.iherb.com/pr/foo/71026">
            California Gold Nutrition, Sport, Pure Creatine Monohydrate, 1 lb (454 g)
          </a>
          <div data-qa-element="product-item-price">
            <span><bdi>$24.00</bdi></span>
            <del><bdi>$30.00</bdi></del>
          </div>
          <div data-qa-element="product-quantity-select" role="button">2</div>
          <button data-qa-element="btn-item-remove">Remove</button>
        </div>
        <div data-qa-element="line-item">
          <a data-qa-element="product-item-image"
             href="https://il.iherb.com/pr/bar/64009"
             aria-label="LactoBif 30 Probiotics">
            <img src="https://img.example/lac.jpg" />
          </a>
          <a data-qa-element="product-item-title" href="https://il.iherb.com/pr/bar/64009">
            California Gold Nutrition, LactoBif® 30 Probiotics
          </a>
          <div data-qa-element="product-item-price"><bdi>$15.50</bdi></div>
          <div data-qa-element="product-quantity-select">1</div>
        </div>
      </div>
    `;
    const items = scrapeCart(root);
    expect(items).toHaveLength(2);

    expect(items[0].name).toBe('California Gold Nutrition, Sport, Pure Creatine Monohydrate, 1 lb (454 g)');
    // $24.00 line / qty 2 → $12.00 per unit.
    expect(items[0].priceUSD).toBe(12);
    expect(items[0].qty).toBe(2);
    expect(items[0].url).toBe('https://il.iherb.com/pr/foo/71026');
    expect(items[0].imgUrl).toBe('https://img.example/cre.jpg');

    expect(items[1].name).toBe('California Gold Nutrition, LactoBif® 30 Probiotics');
    expect(items[1].priceUSD).toBe(15.5);
    expect(items[1].qty).toBe(1);
  });

  it('parses iHerb cart structure where price has no data-qa attribute', () => {
    // Real iHerb cart: per-item price is a <span> with an emotion-generated
    // class, no data-qa-element. Qty widget is a react-select with the value
    // rendered in a sibling <div>; the inner <input> has value="".
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-qa-element="line-item">
        <a data-qa-element="product-item-image" href="/pr/x/71026"
           aria-label="Pure Creatine">
          <img src="https://img.example/cre.jpg" />
        </a>
        <a data-qa-element="product-item-title" href="/pr/x/71026">
          California Gold Nutrition, Sport, Pure Creatine Monohydrate
        </a>
        <div data-qa-element="product-grouping-attributes">
          <span>453 g, Powder</span>
        </div>
        <div data-qa-element="product-display-name-part-number">
          Product code: CGN-01059
        </div>
        <div style="text-align: right;">
          <div class="css-12qcmy9">
            <span class="css-17rwpsc">$30.00</span>
          </div>
        </div>
        <div data-qa-element="product-quantity-select" class="css-xi606m">
          <div>
            <div class="css-en62w7-control">
              <div class="css-fkgymn">
                <div class="css-ncg2a7-singleValue">3</div>
                <div class="css-ckgtw7" data-value="">
                  <input id="react-select-2-input" value="" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <button data-qa-element="btn-item-remove">remove</button>
      </div>
    `;
    const items = scrapeCart(root);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('California Gold Nutrition, Sport, Pure Creatine Monohydrate');
    // $30.00 line / qty 3 → $10.00 per unit.
    expect(items[0].priceUSD).toBe(10);
    expect(items[0].qty).toBe(3);
    expect(items[0].pcode).toBe('CGN-01059');
  });

  it('skips a strikethrough <del> price when there is no data-qa-element on the price', () => {
    // iHerb's dealed cart row has no data-qa-element on the price markup;
    // the strikethrough original ($72.12) appears alongside the discounted
    // ($36.06). We must pick the discounted one.
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-qa-element="line-item">
        <a data-qa-element="product-item-title" href="/pr/x/156614">Wellness Bag</a>
        <div>
          <span>$36.06</span>
          <del><bdi>$72.12</bdi></del>
        </div>
        <div data-qa-element="product-quantity-select">1</div>
      </div>
    `;
    const items = scrapeCart(root);
    expect(items[0].priceUSD).toBe(36.06);
  });

  it('skips strikethrough text even when it appears first in DOM order', () => {
    // findFirstPriceText is the fallback when the data-qa-element price
    // isn't there; verify directly that <del>-wrapped text is ignored.
    const node = document.createElement('div');
    node.innerHTML = `<del>$99.99</del><span>$42.00</span>`;
    expect(findFirstPriceText(node)).toBe('$42.00');
  });

  it('treats the displayed price as a qty-multiplied line subtotal (per Σ priceShown == subtotal)', () => {
    // Mirrors what Claude-in-Chrome verified on the live cart: the visible
    // price under each line-item is qty × unit (post-discount). For the
    // optimizer to split units across carts correctly, the scraper must
    // expose the per-unit price.
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-qa-element="line-item">
        <a data-qa-element="product-item-title" href="/pr/x/1">Five-pack</a>
        <div data-qa-element="product-item-price"><bdi>$22.50</bdi></div>
        <div data-qa-element="product-quantity-select">5</div>
      </div>
    `;
    const items = scrapeCart(root);
    // $22.50 line / qty 5 → $4.50 per unit.
    expect(items[0].priceUSD).toBe(4.5);
    expect(items[0].qty).toBe(5);
  });

  it('reads qty from a native <select> when present', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-qa-element="line-item">
        <a data-qa-element="product-item-title" href="/pr/x/1">X</a>
        <div data-qa-element="product-item-price"><bdi>$10.00</bdi></div>
        <div data-qa-element="product-quantity-select">
          <select>
            <option value="1">1</option>
            <option value="3" selected>3</option>
          </select>
        </div>
      </div>
    `;
    const items = scrapeCart(root);
    expect(items[0].qty).toBe(3);
  });
});
