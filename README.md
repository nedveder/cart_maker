# cart_maker

A Chrome extension that splits your iHerb cart into the smallest set of orders
where each one stays **under** Israel's tax-free import limit (default $75) and
**above** iHerb's free-shipping minimum (default $65), then drives iHerb's cart
APIs to apply the chosen split — checkbox selection *and* per-line quantity
changes — directly on the page.

The planner mounts as a Shadow-DOM-isolated overlay on `iherb.com/cart` itself.
No new tabs, no localhost server, no external services.

![cart_maker overlay](docs/screenshot.png)

## Install

### From a release (recommended)

1. Download `cart_maker-<version>.zip` from the
   [Releases](../../releases) page and unzip it somewhere stable
   (don't unzip then move — Chrome remembers the path).
2. Open `chrome://extensions`.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select the unzipped folder.
5. Visit your iHerb cart, click the cart_maker icon in the toolbar,
   then **Open planner on cart**.

There's no auto-update — to get a new version, download the new zip and
load-unpack it again (Chrome will keep your settings).

### From source

```bash
git clone <this-repo>
cd cart_maker
npm install
npm run build           # produces ./dist
```

Then load `dist/` via Load unpacked, same as above.

## Using it

On your iHerb cart page:

1. Click the toolbar icon → **Open planner on cart**. A floating panel slides
   in from the right.
2. The planner reads your cart, runs a bin-packing optimizer against the two
   thresholds, and proposes one or more splits. Each split shows the items it
   contains, the predicted subtotal, and an **Apply this split** button.
3. Click **Apply this split**. The extension:
   - toggles the per-line checkboxes on iHerb's cart so only that split is selected,
   - adjusts each selected line's quantity to match the planner (when a row is split across carts, e.g. 2 units in this checkout out of 5 you have),
   - re-checks the resulting state and posts a final report to the page console (`[cart_maker] FINAL`).
4. After a clean apply the panel auto-minimizes to a small pill so iHerb's
   "Proceed to Checkout" is unobstructed. Click the pill any time to expand.
5. Check out as normal.
6. Come back, expand the pill, click Apply on the next split, and repeat.

The thresholds are configurable in the panel header and persist across sessions
(via `chrome.storage.local`).

### Toolbar popup

The popup also exposes two diagnostic buttons useful when iHerb redesigns
their cart and the scraper or selectors stop matching:

- **Preview scrape** — logs the current scraped items to the page console.
- **Diagnose** — logs a richer DOM diagnostic (what selectors hit, sample
  cart-row HTML, candidate price text nodes) to help me update the selectors.

## How it works

iHerb's cart is a React app served from `checkout.iherb.com` (sharded to
e.g. `checkout12.iherb.com`). All cart mutations go through two REST endpoints:

| | Toggle a row's "selected" flag | Change a row's quantity |
| - | - | - |
| Method + URL | `PUT /api/Carts/v2/lineitems/toggle` | `PUT /api/Carts/v2/lineitem` |
| Body | `{ lineItems: [{ productId, selected }] }` | `{ productId, quantity }` |
| Response | (status only) | full updated cart JSON |

The extension consists of three coordinated scripts:

- **`content.tsx`** (ISOLATED world) — handles the toolbar popup messages
  (`scrape-cart`, `diagnose-cart`, `toggle-overlay`) and mounts the React
  overlay inside a Shadow-DOM-rooted host on the cart page.
- **`overlay/`** (also ISOLATED, bundled into `content.js`) — the React UI:
  scrapes items via the same `scraper.ts` that the popup uses, runs the
  optimizer (`optimizer.ts`), and on apply posts a `{ cart_maker: 'request' }`
  message to the MAIN world.
- **`inject-main.ts`** (MAIN world) — wraps `XMLHttpRequest` and `fetch` so
  it can observe iHerb's per-toggle PUT responses (and capture the auth
  headers iHerb requires for cart mutations: `Pref`, `CustomerId`,
  `ih-exp-user-id`, `apiseed`). On a `cart_maker:request` message it runs
  the qty-then-toggle flow with retries and posts the final state back via
  `{ cart_maker: 'response' }`.

The toggle pass goes first so the headers get captured; the qty PUTs reuse
those captured headers and read `lineItems[].quantity` out of the response
to detect server-side stock clamping. After both passes a DOM-truth recovery
sweep re-toggles any drifted checkbox once more, and the result is logged
as a single `[cart_maker] FINAL` line.

## What data the extension sees

- The DOM of the iHerb cart page you have open (only when you load the cart).
- The XHR/fetch requests iHerb's own React app makes — read-only, used to
  capture auth headers so we can replay them on our own cart-mutation calls.
- Your threshold preferences stored via `chrome.storage.local` (in your
  browser, not sent anywhere).

It does **not** send any data anywhere outside iHerb. There's no backend, no
analytics, no telemetry. The full source is here.

## Development

```bash
npm install
npm test                # vitest, jsdom-based, 60+ tests
npm run typecheck       # tsc --noEmit
npm run build           # esbuild bundles dist/
npm run package         # build + zip dist/ → cart_maker-<version>.zip
```

### Project layout

```
src/
  manifest.json           MV3 manifest (popup, two content scripts)
  popup.html, popup.ts    toolbar popup
  content.tsx             ISOLATED-world entry: messages + overlay mount
  inject-main.ts          MAIN-world entry: fetch/XHR wrappers + apply flow
  scraper.ts              iHerb cart DOM → CartItem[]
  diagnose.ts             rich DOM diagnostic for selector breakage
  selectInCart.ts         pure library: applySelection + ToggleAwaiter contract
  overlay/                React app for the in-page panel
    App.tsx
    components/           Header, ThresholdsPanel, ItemsList, PlanView
    lib/                  types, optimizer, storage (chrome.storage), apply (postMessage)
    styles.css            Shadow-DOM-scoped styles (light + dark)
  test-setup.ts           jsdom + chrome.storage.local mock
  css.d.ts                ambient `*.css` module declaration
scripts/
  build.mjs               tsc + esbuild
  package.mjs             build + zip
```

### iHerb-specific notes

- The cart page is served from a sharded subdomain (`checkout12.iherb.com`,
  not `checkout.iherb.com`); the manifest matches both.
- Per-line item prices in the DOM are the **qty-multiplied line subtotal**,
  not the unit price. The scraper divides by qty so the optimizer's per-unit
  splitting math is correct.
- The qty endpoint **silently clamps** to available stock; the response
  contains the actual applied qty and the extension reads it back.
- The toggle endpoint returns 503 under burst load; the apply loop awaits
  each PUT response and retries 503/timeout with `[800, 1600, 3200]`ms
  exponential backoff.

### Icons

The toolbar icon is generated from a single SVG (`src/icons/icon.svg`)
into 16/32/48/128 px PNGs via `npm run icons` (uses
[`@resvg/resvg-js`](https://github.com/yisibl/resvg-js), pure JS — no
native dependencies). The PNGs are committed; you only need to re-run
the script after editing the SVG.

### Cutting a release

Releases are automated by GitHub Actions on tag push:

```bash
# bump src/manifest.json + package.json to the new version
git commit -am "v1.2.0"
git tag v1.2.0
git push origin main --tags
```

[`.github/workflows/release.yml`](.github/workflows/release.yml) then
typechecks, tests, builds, packages `dist/` into
`cart_maker-<version>.zip`, and creates a GitHub Release with the zip
attached. Users get a stable
`https://github.com/.../releases/latest/download/cart_maker-<version>.zip`
URL.

## License

MIT.
