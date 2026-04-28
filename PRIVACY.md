# Privacy Policy

_Last updated: 2026-04-28_

cart_maker is a browser extension that helps you split your iHerb shopping
cart into multiple orders that satisfy customs/tax thresholds and iHerb's
free-shipping minimum. This policy describes exactly what data the extension
touches and what it doesn't.

## Summary

**The extension does not collect, transmit, sell, or share any personal
data.** It runs entirely inside your browser. The full source is open and
auditable at [github.com/nedveder/cart_maker](https://github.com/nedveder/cart_maker).

## What the extension does

- **Reads the cart DOM on `iherb.com` cart pages** when you open the
  planner panel. It parses your cart's items (name, price, quantity, image
  URL, iHerb product code/id) so it can compute suggested splits.
- **Calls iHerb's own cart API endpoints** (`PUT /api/Carts/v2/lineitems/toggle`
  and `PUT /api/Carts/v2/lineitem`) on your behalf when you click
  "Apply this split". These are the same endpoints iHerb's own React app
  uses when you click checkboxes or change quantities by hand.
- **Stores your preferred thresholds** (tax-free max, free-shipping min)
  locally via `chrome.storage.local`. These never leave your browser.

## What the extension does *not* do

- **No data is transmitted to any server outside `iherb.com`.** There is no
  backend, no analytics, no telemetry, no advertising, and no third-party
  services. The extension contains no network code other than the calls
  to iHerb's own API on the page you're already on.
- **No data is sold or shared** with anyone, including the extension's
  author.
- **No tracking across sites.** The extension only activates on
  `https://*.iherb.com/cart*` and `https://checkout.iherb.com/*` pages
  (see `manifest.json`). It does not run on any other site.
- **No personally identifiable information is collected.** The extension
  does not read or store your name, email, address, payment details,
  authentication tokens, browsing history, location, or anything outside
  the visible cart contents on the iHerb page you have open.

## Permissions and why we need them

| Permission | What it's used for |
| --- | --- |
| `host_permissions: https://*.iherb.com/*` | Read the cart DOM and call iHerb's cart-mutation APIs on the iHerb domain. |
| `storage` | Save the user's two threshold preferences across sessions. |
| `activeTab` | Let the toolbar popup send commands (open planner, scrape, diagnose) to the active iHerb tab. |
| `scripting` | Re-inject the content script on demand if the iHerb cart page was loaded before the extension was enabled. No external code is loaded. |

## Data retention

- Threshold preferences live in `chrome.storage.local` for as long as the
  extension remains installed. Uninstalling the extension clears them.
- No data is retained anywhere else.

## Children's privacy

The extension does not knowingly collect any data, including from children.

## Changes to this policy

If material changes are ever made to this policy, the updated version
will be committed to the repository and the "Last updated" date above will
change.

## Contact

Questions or concerns? Open an issue at
<https://github.com/nedveder/cart_maker/issues>.
