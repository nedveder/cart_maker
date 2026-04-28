type Props = {
  onClose: () => void;
  onRefresh: () => void;
  onMinimize: () => void;
};

export function CartLogo() {
  return (
    <div className="cm-logo" aria-hidden>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M3 6h18l-2 11a2 2 0 0 1-2 1.7H7a2 2 0 0 1-2-1.7L3 6Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M9 6V4a3 3 0 0 1 6 0v2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M9 11l2 2 4-4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function Header({ onClose, onRefresh, onMinimize }: Props) {
  return (
    <header className="cm-header">
      <div className="cm-brand">
        <CartLogo />
        <div>
          <h1>cart_maker</h1>
          <p>Split your cart for free shipping under the tax-free limit.</p>
        </div>
      </div>
      <div className="cm-header-actions">
        <button
          className="cm-icon-btn"
          onClick={onRefresh}
          title="Re-scrape cart"
          aria-label="Re-scrape cart"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 12a9 9 0 1 1-3.5-7.1M21 4v5h-5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="cm-icon-btn"
          onClick={onMinimize}
          title="Minimize"
          aria-label="Minimize planner"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 12h14"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="cm-icon-btn"
          onClick={onClose}
          title="Close"
          aria-label="Close planner"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 6l12 12M18 6 6 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}
