import { CartItem, lineTotal } from '../lib/types';

type Props = {
  items: CartItem[];
  onRefresh: () => void;
};

const usd = (n: number): string =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export function ItemsList({ items, onRefresh }: Props) {
  const total = items.reduce((s, i) => s + lineTotal(i), 0);

  if (items.length === 0) {
    return (
      <section className="cm-section">
        <div className="cm-section-head">
          <h2>Cart items</h2>
        </div>
        <div className="cm-empty">
          <p>No items detected on this page.</p>
          <button className="cm-link-btn" onClick={onRefresh}>
            Re-scan
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="cm-section">
      <div className="cm-section-head">
        <h2>Cart items</h2>
        <p>
          {items.length} line{items.length === 1 ? '' : 's'} ·{' '}
          <strong>{usd(total)}</strong>
        </p>
      </div>
      <ul className="cm-items">
        {items.map(item => (
          <li key={item.id} className="cm-item">
            {item.imgUrl ? (
              <img className="cm-item-thumb" src={item.imgUrl} alt="" />
            ) : (
              <div className="cm-item-thumb cm-item-thumb-empty" />
            )}
            <div className="cm-item-meta">
              <span className="cm-item-name" title={item.name}>
                {item.name || '(unnamed)'}
              </span>
              <span className="cm-item-detail">
                {item.qty > 1 ? `${item.qty} × ${usd(item.priceUSD)}` : usd(item.priceUSD)}
              </span>
            </div>
            <span className="cm-item-line">{usd(lineTotal(item))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
