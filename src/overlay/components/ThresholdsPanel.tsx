import { Settings } from '../lib/types';

type Props = {
  settings: Settings;
  onChange: (s: Settings) => void;
};

export function ThresholdsPanel({ settings, onChange }: Props) {
  return (
    <section className="cm-section">
      <div className="cm-section-head">
        <h2>Thresholds</h2>
        <p>Each split stays in this band.</p>
      </div>
      <div className="cm-thresholds">
        <label className="cm-field">
          <span className="cm-field-label">Tax-free max</span>
          <span className="cm-field-input">
            <span className="cm-prefix">$</span>
            <input
              type="number"
              min={0}
              step={1}
              value={settings.taxFreeMaxUSD}
              onChange={e =>
                onChange({
                  ...settings,
                  taxFreeMaxUSD: Number(e.target.value),
                })
              }
            />
          </span>
        </label>
        <label className="cm-field">
          <span className="cm-field-label">Free-shipping min</span>
          <span className="cm-field-input">
            <span className="cm-prefix">$</span>
            <input
              type="number"
              min={0}
              step={1}
              value={settings.freeShippingMinUSD}
              onChange={e =>
                onChange({
                  ...settings,
                  freeShippingMinUSD: Number(e.target.value),
                })
              }
            />
          </span>
        </label>
      </div>
    </section>
  );
}
