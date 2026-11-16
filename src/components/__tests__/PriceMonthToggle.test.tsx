import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PriceMonthToggle, type PriceMonthChoice } from '../PriceMonthToggle';
import { jsonResponse } from './fixtures';

function Harness({ onChange }: { onChange: (choice: PriceMonthChoice) => void }) {
  const [value, setValue] = useState<PriceMonthChoice>('current');
  return (
    <PriceMonthToggle
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('PriceMonthToggle', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/fuel-prices?month=current') return jsonResponse([{ month: '2026-10' }]);
      if (url === '/api/fuel-prices?month=previous') return jsonResponse([{ month: '2026-09' }]);
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads both months and shows their formatted labels', async () => {
    render(<Harness onChange={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /This month/ })).toBeChecked();
    // formatMonth('2026-10') / ('2026-09') — labels arrive asynchronously from the API.
    expect(await screen.findByText('October 2026')).toBeInTheDocument();
    expect(screen.getByText('September 2026')).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/fuel-prices?month=current',
      '/api/fuel-prices?month=previous',
    ]);
  });

  it('calls onChange with the selected month', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    await screen.findByText('October 2026');

    await user.click(screen.getByRole('radio', { name: /Last month/ }));
    expect(onChange).toHaveBeenCalledWith('previous');
    expect(screen.getByRole('radio', { name: /Last month/ })).toBeChecked();

    onChange.mockClear();
    await user.click(screen.getByRole('radio', { name: /This month/ }));
    expect(onChange).toHaveBeenCalledWith('current');
    expect(screen.getByRole('radio', { name: /This month/ })).toBeChecked();
  });
});
