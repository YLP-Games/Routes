import { useId, useState } from 'react';

export interface DepartureTimePickerProps {
  /** ISO datetime, or undefined for "leave now". */
  value: string | undefined;
  onChange: (iso: string | undefined) => void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DDTHH:mm' in local time, for <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Next quarter hour, at least 5 minutes from now. */
function defaultDeparture(): Date {
  const d = new Date(Date.now() + 5 * 60_000);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  return d;
}

export function DepartureTimePicker({ value, onChange }: DepartureTimePickerProps) {
  const id = useId();
  const [mode, setMode] = useState<'now' | 'at'>(value ? 'at' : 'now');
  const [local, setLocal] = useState(() => (value ? toLocalInput(new Date(value)) : ''));

  function choose(next: 'now' | 'at') {
    setMode(next);
    if (next === 'now') {
      onChange(undefined);
      return;
    }
    const start = local || toLocalInput(defaultDeparture());
    setLocal(start);
    emit(start);
  }

  function emit(localValue: string) {
    const d = new Date(localValue);
    onChange(Number.isNaN(d.getTime()) ? undefined : d.toISOString());
  }

  return (
    <fieldset className="field-group">
      <legend>Departure</legend>
      <div className="segmented" role="radiogroup" aria-label="Departure time">
        <label className={`segment ${mode === 'now' ? 'is-active' : ''}`}>
          <input type="radio" name={`${id}-mode`} value="now" checked={mode === 'now'} onChange={() => choose('now')} />
          Leave now
        </label>
        <label className={`segment ${mode === 'at' ? 'is-active' : ''}`}>
          <input type="radio" name={`${id}-mode`} value="at" checked={mode === 'at'} onChange={() => choose('at')} />
          Depart at
        </label>
      </div>
      {mode === 'at' && (
        <label className="field">
          <span className="field-label">Departure date and time</span>
          <input
            type="datetime-local"
            value={local}
            onChange={(e) => {
              setLocal(e.target.value);
              emit(e.target.value);
            }}
          />
        </label>
      )}
    </fieldset>
  );
}
