import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartureTimePicker } from '../DepartureTimePicker';

const leaveNow = () => screen.getByRole('radio', { name: 'Leave now' });
const departAt = () => screen.getByRole('radio', { name: 'Depart at' });
const dateInput = () => screen.queryByLabelText('Departure date and time') as HTMLInputElement | null;

/** True only for a canonical ISO timestamp (what the component is expected to emit). */
function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

describe('DepartureTimePicker', () => {
  it('defaults to "Leave now" and reveals the date input on "Depart at"', async () => {
    const onChange = vi.fn();
    render(<DepartureTimePicker value={undefined} onChange={onChange} />);

    expect(leaveNow()).toBeChecked();
    expect(departAt()).not.toBeChecked();
    expect(dateInput()).not.toBeInTheDocument();

    await userEvent.click(departAt());

    expect(departAt()).toBeChecked();
    expect(leaveNow()).not.toBeChecked();
    expect(dateInput()).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(isIso(onChange.mock.calls[0][0])).toBe(true);
  });

  it('starts in "Depart at" mode with the local time of an initial value', () => {
    // Built from local components so the expected input value is time-zone independent.
    const initial = new Date(2026, 9, 19, 7, 30); // 19 Oct 2026, 07:30 local
    const onChange = vi.fn();
    render(<DepartureTimePicker value={initial.toISOString()} onChange={onChange} />);

    expect(departAt()).toBeChecked();
    expect(leaveNow()).not.toBeChecked();
    expect(dateInput()).toHaveValue('2026-10-19T07:30');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits a valid ISO string when the datetime changes', async () => {
    const onChange = vi.fn();
    render(<DepartureTimePicker value={undefined} onChange={onChange} />);
    await userEvent.click(departAt());
    onChange.mockClear();

    fireEvent.change(dateInput()!, { target: { value: '2026-12-25T09:45' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as string | undefined;
    expect(isIso(emitted)).toBe(true);
    // Compare instants, not the string, so the assertion holds in any time zone.
    expect(new Date(emitted!).getTime()).toBe(new Date(2026, 11, 25, 9, 45).getTime());
  });

  it('emits undefined when switching back to "Leave now"', async () => {
    const onChange = vi.fn();
    render(<DepartureTimePicker value={undefined} onChange={onChange} />);

    await userEvent.click(departAt());
    expect(isIso(onChange.mock.calls.at(-1)?.[0])).toBe(true);
    onChange.mockClear();

    await userEvent.click(leaveNow());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(dateInput()).not.toBeInTheDocument();
  });

  it('does not emit garbage for empty or invalid datetimes', async () => {
    const onChange = vi.fn();
    render(<DepartureTimePicker value={undefined} onChange={onChange} />);
    await userEvent.click(departAt());
    onChange.mockClear();

    fireEvent.change(dateInput()!, { target: { value: '' } });
    // jsdom sanitises an invalid datetime-local value to '', but emit() guards both cases.
    fireEvent.change(dateInput()!, { target: { value: 'not-a-date' } });

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.every(([value]) => value === undefined || isIso(value))).toBe(true);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
