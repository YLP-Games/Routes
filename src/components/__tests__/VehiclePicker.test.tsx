import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VehiclePicker } from '../VehiclePicker';
import { DEFAULT_VEHICLE_CHOICE, hasConsumption, parseCustomConsumption, type VehicleChoice } from '../../lib/options';
import { hilux, jsonResponse, polo } from './fixtures';

function Harness({ onChange }: { onChange: (c: VehicleChoice) => void }) {
  const [value, setValue] = useState<VehicleChoice>(DEFAULT_VEHICLE_CHOICE);
  return (
    <VehiclePicker
      value={value}
      debounceMs={50}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('VehiclePicker', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/vehicles')) return jsonResponse([polo, hilux]);
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('debounces search, lists results and selects a vehicle with its default fuel', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.type(screen.getByLabelText('Search make or model'), 'hilux');
    await screen.findByRole('button', { name: /Toyota Hilux 2.4 GD-6 Raider/ });

    // Debounced: one request for the final query rather than one per keystroke.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/vehicles?q=hilux');
    expect(screen.getByRole('button', { name: /Volkswagen Polo Vivo 1.4 Trendline.*5.9 L\/100 km/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Toyota Hilux/ }));
    const last = onChange.mock.calls.at(-1)![0] as VehicleChoice;
    expect(last.vehicle?.id).toBe(hilux.id);
    expect(last.fuel).toBe('diesel50ppm');
    expect(hasConsumption(last)).toBe(true);
    expect(screen.getByText('Toyota Hilux 2.4 GD-6 Raider')).toBeInTheDocument();
    expect(screen.getByText(/7.8 L\/100 km combined/)).toBeInTheDocument();
    expect(screen.getByLabelText('Fuel')).toHaveValue('diesel50ppm');
  });

  it('selecting a petrol car defaults to Petrol 95', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Search make or model'), 'polo');
    await user.click(await screen.findByRole('button', { name: /Polo Vivo/ }));
    expect(onChange.mock.calls.at(-1)![0].fuel).toBe('petrol95');
  });

  it('shows search errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'X', message: 'Catalogue unavailable' } }, 500));
    const user = userEvent.setup();
    render(<Harness onChange={vi.fn()} />);
    await user.type(screen.getByLabelText('Search make or model'), 'ab');
    expect(await screen.findByRole('alert')).toHaveTextContent('Catalogue unavailable');
  });

  it('accepts custom consumption within 1–40 L/100 km', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    await user.click(screen.getByLabelText('Enter my own consumption'));
    const input = screen.getByLabelText('Consumption (L/100 km)');
    await user.type(input, '45');
    expect(screen.getByText(/between 1 and 40/)).toBeInTheDocument();
    expect(hasConsumption(onChange.mock.calls.at(-1)![0])).toBe(false);

    await user.clear(input);
    await user.type(input, '7.5');
    const last = onChange.mock.calls.at(-1)![0] as VehicleChoice;
    expect(last.useCustom).toBe(true);
    expect(parseCustomConsumption(last.customConsumption)).toBe(7.5);
    expect(hasConsumption(last)).toBe(true);
    expect(screen.queryByText(/between 1 and 40/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Price zone'), 'coastal');
    expect(onChange.mock.calls.at(-1)![0].zone).toBe('coastal');
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
