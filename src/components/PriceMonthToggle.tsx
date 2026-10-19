import { useEffect, useId, useState } from 'react';
import { getFuelPrices } from '../lib/apiClient';
import { formatMonth } from '../lib/format';

export type PriceMonthChoice = 'current' | 'previous';

export interface PriceMonthToggleProps {
  value: PriceMonthChoice;
  onChange: (next: PriceMonthChoice) => void;
  disabled?: boolean;
}

/** Segmented "This month" / "Last month" control; shows real month names once loaded. */
export function PriceMonthToggle({ value, onChange, disabled }: PriceMonthToggleProps) {
  const id = useId();
  // Month each selector resolves to. The server decides what 'current' means (the newest month whose
  // prices are already effective), which is not always the newest month in the table, so ask it.
  const [months, setMonths] = useState<Partial<Record<PriceMonthChoice, string>>>({});

  useEffect(() => {
    let cancelled = false;
    for (const selector of ['current', 'previous'] as const) {
      getFuelPrices({ month: selector })
        .then((prices) => {
          const month = Array.isArray(prices) ? prices[0]?.month : undefined;
          if (!cancelled && month) setMonths((prev) => ({ ...prev, [selector]: month }));
        })
        .catch(() => {
          // Labels fall back to "This month" / "Last month".
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const options: { value: PriceMonthChoice; label: string; month?: string }[] = [
    { value: 'current', label: 'This month', month: months.current },
    { value: 'previous', label: 'Last month', month: months.previous },
  ];

  return (
    <fieldset className="field-group" disabled={disabled}>
      <legend>Fuel prices</legend>
      <div className="segmented" role="radiogroup" aria-label="Fuel price month">
        {options.map((o) => (
          <label key={o.value} className={`segment ${value === o.value ? 'is-active' : ''}`}>
            <input type="radio" name={`${id}-month`} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="segment-label">{o.label}</span>
            {o.month && <span className="segment-sub">{formatMonth(o.month)}</span>}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
