import { CartItem, Cart, Plan, Settings } from './types';

type Unit = {
  itemId: string;
  priceUSD: number;
  source: CartItem;
};

const expandUnits = (items: CartItem[]): Unit[] =>
  items.flatMap(item =>
    Array.from({ length: item.qty }, () => ({
      itemId: item.id,
      priceUSD: item.priceUSD,
      source: item,
    })),
  );

/**
 * Group a flat list of units back into per-product CartItems, where the
 * resulting qty is the number of units of that product in the group.
 */
const aggregateUnits = (units: Unit[]): CartItem[] => {
  const byItemId = new Map<string, { item: CartItem; count: number }>();
  for (const u of units) {
    const existing = byItemId.get(u.itemId);
    if (existing) existing.count += 1;
    else byItemId.set(u.itemId, { item: u.source, count: 1 });
  }
  return Array.from(byItemId.values()).map(({ item, count }) => ({
    ...item,
    qty: count,
  }));
};

const sumPrice = (units: Unit[]): number =>
  units.reduce((s, u) => s + u.priceUSD, 0);

/**
 * Pack cart items into the minimum number of "shipments" where each shipment:
 *   freeShippingMinUSD <= total <= taxFreeMaxUSD
 *
 * Strategy:
 *   1. Expand each line item into individual units (so a qty-3 item becomes
 *      three packable units that can be split across carts).
 *   2. First-Fit Decreasing into bins of capacity taxFreeMaxUSD.
 *   3. Merge bins that fall short of freeShippingMinUSD when combinable.
 *   4. Re-aggregate units back into per-product CartItems within each cart.
 *
 * Single units priced above taxFreeMaxUSD (rare on iHerb) cannot ship at all
 * and are reported as leftover.
 */
export function optimize(items: CartItem[], settings: Settings): Plan {
  const warnings: string[] = [];

  const allUnits = expandUnits(items);
  const oversized: Unit[] = [];
  const packable: Unit[] = [];
  for (const u of allUnits) {
    if (u.priceUSD > settings.taxFreeMaxUSD) oversized.push(u);
    else packable.push(u);
  }
  if (oversized.length > 0) {
    warnings.push(
      `${oversized.length} unit(s) priced above the tax-free limit on their own — skip them or accept tax.`,
    );
  }

  const sorted = [...packable].sort((a, b) => b.priceUSD - a.priceUSD);
  const bins: Unit[][] = [];
  for (const unit of sorted) {
    let placed = false;
    for (const bin of bins) {
      if (sumPrice(bin) + unit.priceUSD <= settings.taxFreeMaxUSD) {
        bin.push(unit);
        placed = true;
        break;
      }
    }
    if (!placed) bins.push([unit]);
  }

  const valid: Cart[] = [];
  const incomplete: Unit[][] = [];
  for (const bin of bins) {
    const total = sumPrice(bin);
    if (total >= settings.freeShippingMinUSD) {
      valid.push({ items: aggregateUnits(bin), total });
    } else {
      incomplete.push(bin);
    }
  }

  let didMerge = true;
  while (didMerge && incomplete.length > 1) {
    didMerge = false;
    outer: for (let i = 0; i < incomplete.length; i++) {
      for (let j = i + 1; j < incomplete.length; j++) {
        const ti = sumPrice(incomplete[i]);
        const tj = sumPrice(incomplete[j]);
        if (ti + tj <= settings.taxFreeMaxUSD) {
          incomplete[i] = [...incomplete[i], ...incomplete[j]];
          incomplete.splice(j, 1);
          const newTotal = ti + tj;
          if (newTotal >= settings.freeShippingMinUSD) {
            valid.push({ items: aggregateUnits(incomplete[i]), total: newTotal });
            incomplete.splice(i, 1);
          }
          didMerge = true;
          break outer;
        }
      }
    }
  }

  const leftoverUnits = [...oversized, ...incomplete.flat()];
  if (incomplete.length > 0) {
    warnings.push(
      `${incomplete.flat().length} unit(s) couldn't reach the free-shipping minimum — order them with another cart, add more items, or accept paid shipping.`,
    );
  }

  valid.sort((a, b) => b.total - a.total);
  return {
    carts: valid,
    leftover: aggregateUnits(leftoverUnits),
    warnings,
  };
}
