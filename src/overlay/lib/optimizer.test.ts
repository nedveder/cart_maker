import { describe, it, expect } from 'vitest';
import { optimize } from './optimizer';
import { CartItem, Settings } from './types';

const settings: Settings = { taxFreeMaxUSD: 75, freeShippingMinUSD: 40 };

const item = (id: string, priceUSD: number, qty = 1): CartItem => ({
  id,
  name: `item-${id}`,
  priceUSD,
  qty,
});

describe('optimize', () => {
  it('returns empty plan for no items', () => {
    const plan = optimize([], settings);
    expect(plan.carts).toEqual([]);
    expect(plan.leftover).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('flags an item that exceeds tax-free limit on its own as leftover', () => {
    const items = [item('a', 80)];
    const plan = optimize(items, settings);
    expect(plan.carts).toEqual([]);
    expect(plan.leftover).toHaveLength(1);
    expect(plan.leftover[0].id).toBe('a');
    expect(plan.warnings.join(' ')).toMatch(/above the tax-free limit/);
  });

  it('splits qty across carts when line total exceeds tax-free limit', () => {
    // 3 × $30 = $90 line total, but a 2-pack ($60) fits a single cart and
    // is also above the $40 free-shipping minimum.
    const items = [item('a', 30, 3)];
    const plan = optimize(items, settings);
    expect(plan.carts).toHaveLength(1);
    expect(plan.carts[0].items).toEqual([
      expect.objectContaining({ id: 'a', qty: 2 }),
    ]);
    expect(plan.carts[0].total).toBe(60);
    // The third unit can't reach the $40 minimum on its own → leftover.
    expect(plan.leftover).toEqual([
      expect.objectContaining({ id: 'a', qty: 1 }),
    ]);
  });

  it('packs a single valid cart when items fit and meet shipping minimum', () => {
    const items = [item('a', 30), item('b', 25)];
    const plan = optimize(items, settings);
    expect(plan.carts).toHaveLength(1);
    expect(plan.carts[0].total).toBe(55);
    expect(plan.leftover).toEqual([]);
  });

  it('splits items that together exceed tax-free limit into two valid carts', () => {
    const items = [item('a', 40), item('b', 35), item('c', 30), item('d', 25)];
    const plan = optimize(items, settings);
    expect(plan.carts).toHaveLength(2);
    for (const cart of plan.carts) {
      expect(cart.total).toBeLessThanOrEqual(settings.taxFreeMaxUSD);
      expect(cart.total).toBeGreaterThanOrEqual(settings.freeShippingMinUSD);
    }
    const allItems = plan.carts.flatMap(c => c.items);
    expect(allItems).toHaveLength(4);
  });

  it('reports leftover when total is below shipping minimum and no merge possible', () => {
    const items = [item('a', 10), item('b', 15)];
    const plan = optimize(items, settings);
    expect(plan.carts).toEqual([]);
    expect(plan.leftover).toHaveLength(2);
    expect(plan.warnings.join(' ')).toMatch(/free-shipping minimum/);
  });

  it('merges incomplete bins when their combined total fits', () => {
    // FFD with cap 75: [70], [10] — second bin is below the $40 minimum.
    // Merged total 80 still exceeds the cap, so this stays leftover.
    const lowSettings: Settings = { taxFreeMaxUSD: 75, freeShippingMinUSD: 40 };
    const items = [item('a', 70), item('b', 10)];
    const plan = optimize(items, lowSettings);
    expect(plan.carts).toHaveLength(1);
    expect(plan.carts[0].items.map(i => i.id)).toEqual(['a']);
    expect(plan.leftover.map(i => i.id)).toEqual(['b']);
  });

  it('keeps multi-qty items together in one cart when they all fit', () => {
    const items = [item('a', 20, 2), item('b', 25, 1)];
    const plan = optimize(items, settings);
    expect(plan.carts).toHaveLength(1);
    expect(plan.carts[0].total).toBe(65);
    const a = plan.carts[0].items.find(i => i.id === 'a');
    expect(a?.qty).toBe(2);
  });

  it('packs a realistic 8-item cart into 2 valid carts', () => {
    const items = [
      item('a', 22),
      item('b', 18),
      item('c', 30),
      item('d', 15),
      item('e', 12),
      item('f', 28),
      item('g', 9),
      item('h', 14),
    ];
    const plan = optimize(items, settings);
    expect(plan.carts.length).toBeGreaterThanOrEqual(2);
    for (const cart of plan.carts) {
      expect(cart.total).toBeGreaterThanOrEqual(settings.freeShippingMinUSD);
      expect(cart.total).toBeLessThanOrEqual(settings.taxFreeMaxUSD);
    }
    const totalItems =
      plan.carts.flatMap(c => c.items).length + plan.leftover.length;
    expect(totalItems).toBe(items.length);
  });

  it('preserves total qty across carts + leftover when an item is split', () => {
    const items = [item('vit-c', 30, 5), item('cre', 35, 1)];
    const plan = optimize(items, settings);
    const totalQty = (xs: typeof items) => xs.reduce((s, i) => s + i.qty, 0);
    const allOut = [...plan.carts.flatMap(c => c.items), ...plan.leftover];
    expect(totalQty(allOut)).toBe(totalQty(items));
  });

  it('flags a single unit priced above tax-free limit as leftover', () => {
    const items = [item('a', 100, 1)];
    const plan = optimize(items, settings);
    expect(plan.carts).toEqual([]);
    expect(plan.leftover).toEqual([
      expect.objectContaining({ id: 'a', qty: 1 }),
    ]);
    expect(plan.warnings.join(' ')).toMatch(/above the tax-free limit/);
  });

  it('produces no duplicate items across carts and leftover', () => {
    const items = Array.from({ length: 12 }, (_, k) =>
      item(`x${k}`, 8 + k * 3),
    );
    const plan = optimize(items, settings);
    const seen = new Set<string>();
    for (const id of [
      ...plan.carts.flatMap(c => c.items.map(i => i.id)),
      ...plan.leftover.map(i => i.id),
    ]) {
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(items.length);
  });
});
