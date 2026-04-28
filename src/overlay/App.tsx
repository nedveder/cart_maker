import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartItem, Settings, DEFAULT_SETTINGS } from './lib/types';
import { optimize } from './lib/optimizer';
import { loadSettings, saveSettings } from './lib/storage';
import { applyCartSpec, ApplyResult } from './lib/apply';
import { scrapeCart } from '../scraper';
import { Header, CartLogo } from './components/Header';
import { ThresholdsPanel } from './components/ThresholdsPanel';
import { ItemsList } from './components/ItemsList';
import { PlanView } from './components/PlanView';

type Props = {
  onClose: () => void;
};

export type ApplyState = {
  cartIdx: number;
  status: 'pending' | 'done' | 'error';
  result?: ApplyResult;
  error?: string;
};

export default function App({ onClose }: Props) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState | null>(null);
  const [minimized, setMinimized] = useState(false);

  const refresh = useCallback(() => {
    // ScrapedItem is a structural superset of CartItem; safe to alias.
    setItems(scrapeCart(document) as CartItem[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSettings().then(s => {
      if (cancelled) return;
      setSettings(s);
      setHydrated(true);
    });
    refresh();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (hydrated) void saveSettings(settings);
  }, [hydrated, settings]);

  const plan = useMemo(() => optimize(items, settings), [items, settings]);

  const handleApply = useCallback(
    async (cartIdx: number) => {
      const cart = plan.carts[cartIdx];
      if (!cart) return;
      setApplyState({ cartIdx, status: 'pending' });
      try {
        const result = await applyCartSpec(cart.items);
        setApplyState({ cartIdx, status: 'done', result });
        // Re-scrape so the items panel reflects iHerb's post-apply state
        // (e.g. server-side clamped quantities).
        setTimeout(refresh, 800);
        // Auto-minimize on a clean apply so iHerb's cart is fully visible
        // for checkout. If there's drift, stay open so the warning is seen.
        const clean =
          result.missing.length === 0 && result.extra.length === 0;
        if (clean) {
          setTimeout(() => setMinimized(true), 1200);
        }
      } catch (err) {
        setApplyState({
          cartIdx,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [plan.carts, refresh],
  );

  if (minimized) {
    const splitsLabel =
      plan.carts.length === 0
        ? 'no splits yet'
        : `${plan.carts.length} split${plan.carts.length === 1 ? '' : 's'}`;
    return (
      <button
        className="cm-pill"
        onClick={() => setMinimized(false)}
        title="Open planner"
        aria-label="Open planner"
      >
        <CartLogo />
        <span className="cm-pill-label">cart_maker</span>
        <span className="cm-pill-count">{splitsLabel}</span>
      </button>
    );
  }

  const isApplying = applyState?.status === 'pending';

  return (
    <aside className="cm-panel" role="dialog" aria-label="cart_maker planner">
      <Header
        onClose={onClose}
        onRefresh={refresh}
        onMinimize={() => setMinimized(true)}
      />
      <div className="cm-body" aria-busy={isApplying}>
        <ThresholdsPanel settings={settings} onChange={setSettings} />
        <ItemsList items={items} onRefresh={refresh} />
        <PlanView
          plan={plan}
          onApply={handleApply}
          applyState={applyState}
        />
        {isApplying && (
          <div className="cm-applying-veil" role="status" aria-live="polite">
            <div className="cm-applying-card">
              <div className="cm-spinner" aria-hidden />
              <p className="cm-applying-title">Applying split…</p>
              <p className="cm-applying-hint">
                Updating quantities and cart selection on iHerb.
                <br />
                This usually takes a few seconds.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
