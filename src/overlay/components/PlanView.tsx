import { CartItem, Plan, lineTotal } from '../lib/types';
import { ApplyState } from '../App';

type Props = {
  plan: Plan;
  onApply: (cartIdx: number) => void;
  applyState: ApplyState | null;
};

const usd = (n: number): string =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const buildOriginalQtyMap = (plan: Plan): Map<string, number> => {
  const map = new Map<string, number>();
  for (const c of plan.carts) {
    for (const i of c.items) map.set(i.id, (map.get(i.id) ?? 0) + i.qty);
  }
  for (const i of plan.leftover) {
    map.set(i.id, (map.get(i.id) ?? 0) + i.qty);
  }
  return map;
};

const QtyTag = ({ item, originalQty }: { item: CartItem; originalQty: number }) => {
  const isSplit = originalQty > item.qty;
  if (item.qty === 1 && !isSplit) return null;
  return (
    <span className={isSplit ? 'cm-qty cm-qty-split' : 'cm-qty'}>
      × {item.qty}
      {isSplit && ` of ${originalQty}`}
    </span>
  );
};

export function PlanView({ plan, onApply, applyState }: Props) {
  if (plan.carts.length === 0 && plan.leftover.length === 0) {
    return null;
  }

  const originalQty = buildOriginalQtyMap(plan);

  return (
    <section className="cm-section">
      <div className="cm-section-head">
        <h2>Suggested splits</h2>
        <p>
          {plan.carts.length} cart{plan.carts.length === 1 ? '' : 's'}
          {plan.leftover.length > 0 && ` · ${plan.leftover.length} leftover`}
        </p>
      </div>

      {plan.warnings.map((w, idx) => (
        <p key={idx} className="cm-warning">
          {w}
        </p>
      ))}

      <div className="cm-carts">
        {plan.carts.map((cart, idx) => {
          const isThisApplying =
            applyState?.cartIdx === idx && applyState.status === 'pending';
          const lastResult = applyState?.cartIdx === idx ? applyState : null;
          return (
            <div key={idx} className="cm-cart">
              <div className="cm-cart-head">
                <span className="cm-cart-title">Cart {idx + 1}</span>
                <span className="cm-cart-total">{usd(cart.total)}</span>
              </div>
              <ul className="cm-cart-items">
                {cart.items.map(i => (
                  <li key={i.id}>
                    <span className="cm-cart-item-name" title={i.name}>
                      {i.name || '(unnamed)'}
                    </span>
                    <QtyTag
                      item={i}
                      originalQty={originalQty.get(i.id) ?? i.qty}
                    />
                    <span className="cm-cart-item-price">
                      {usd(lineTotal(i))}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                className="cm-apply-btn"
                onClick={() => onApply(idx)}
                disabled={isThisApplying}
              >
                {isThisApplying ? 'Applying…' : 'Apply this split'}
              </button>
              {lastResult?.status === 'done' && lastResult.result && (
                <ApplyOutcome
                  result={lastResult.result}
                  expectedTotal={cart.total}
                />
              )}
              {lastResult?.status === 'error' && (
                <p className="cm-warning">⚠ {lastResult.error}</p>
              )}
            </div>
          );
        })}
      </div>

      {plan.leftover.length > 0 && (
        <div className="cm-leftover">
          <h3>Leftover</h3>
          <ul className="cm-cart-items">
            {plan.leftover.map(i => (
              <li key={i.id}>
                <span className="cm-cart-item-name" title={i.name}>
                  {i.name || '(unnamed)'}
                </span>
                <QtyTag
                  item={i}
                  originalQty={originalQty.get(i.id) ?? i.qty}
                />
                <span className="cm-cart-item-price">
                  {usd(lineTotal(i))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ApplyOutcome({
  result,
  expectedTotal,
}: {
  result: import('../lib/apply').ApplyResult;
  expectedTotal: number;
}) {
  const driftCount = result.missing.length + result.extra.length;
  const live = result.liveSubtotal ?? '—';
  const expected = `$${expectedTotal.toFixed(2)}`;
  const matches =
    result.liveSubtotal != null &&
    Math.abs(parseFloat(result.liveSubtotal.replace(/[^0-9.]/g, '')) - expectedTotal) <
      0.01;

  return (
    <div
      className={
        driftCount === 0 && matches ? 'cm-outcome cm-outcome-ok' : 'cm-outcome cm-outcome-warn'
      }
    >
      <div className="cm-outcome-row">
        <span>iHerb subtotal</span>
        <strong>{live}</strong>
      </div>
      <div className="cm-outcome-row">
        <span>Predicted</span>
        <strong>{expected}</strong>
      </div>
      {driftCount > 0 && (
        <div className="cm-outcome-row">
          <span>Drift</span>
          <strong>{driftCount} item(s)</strong>
        </div>
      )}
    </div>
  );
}
