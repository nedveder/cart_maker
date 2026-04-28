export type CartItem = {
  id: string;
  name: string;
  /** Per-unit price (lineTotal = priceUSD × qty). The scraper divides
   *  iHerb's qty-multiplied line subtotal by qty to get this. */
  priceUSD: number;
  qty: number;
  /** iHerb part number, e.g. "CGN-01059". */
  pcode?: string;
  /** Numeric product id, e.g. "71026". Used to drive the cart-row checkboxes. */
  pid?: string;
  weightLb?: number;
  url?: string;
  imgUrl?: string;
};

export type Settings = {
  taxFreeMaxUSD: number;
  freeShippingMinUSD: number;
};

export type Cart = {
  items: CartItem[];
  total: number;
};

export type Plan = {
  carts: Cart[];
  leftover: CartItem[];
  warnings: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  taxFreeMaxUSD: 75,
  freeShippingMinUSD: 65,
};

export const lineTotal = (item: CartItem): number => item.priceUSD * item.qty;
