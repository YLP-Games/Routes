import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteBuilder, type RouteBuilderProps } from '../RouteBuilder';

const A = { lat: -26.2041, lng: 28.0473 };
const V = { lat: -26.1, lng: 28.05 };
const B = { lat: -25.7479, lng: 28.2293 };

function setup(overrides: Partial<RouteBuilderProps> = {}) {
  const props: RouteBuilderProps = {
    points: [],
    hasConsumption: false,
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onClear: vi.fn(),
    onCalculate: vi.fn(),
    ...overrides,
  };
  render(<RouteBuilder {...props} />);
  return props;
}

const calcButton = () => screen.getByRole('button', { name: /Calculate trip|Calculating/ });

describe('RouteBuilder', () => {
  it('shows the hint and disables Calculate with no points', () => {
    setup({ hasConsumption: true });
    expect(screen.getByText(/Click the map to add points in order/)).toBeInTheDocument();
    expect(calcButton()).toBeDisabled();
  });

  it('stays disabled with one point', () => {
    setup({ points: [A], hasConsumption: true });
    expect(calcButton()).toBeDisabled();
  });

  it('stays disabled without a vehicle or consumption', () => {
    setup({ points: [A, B], hasConsumption: false });
    expect(calcButton()).toBeDisabled();
    expect(screen.getByText(/Choose your car/)).toBeInTheDocument();
  });

  it('enables Calculate with two points and consumption', async () => {
    const props = setup({ points: [A, B], hasConsumption: true });
    expect(calcButton()).toBeEnabled();
    await userEvent.click(calcButton());
    expect(props.onCalculate).toHaveBeenCalledTimes(1);
  });

  it('disables Calculate while calculating', () => {
    setup({ points: [A, B], hasConsumption: true, calculating: true });
    expect(calcButton()).toBeDisabled();
    expect(calcButton()).toHaveTextContent('Calculating…');
  });

  it('labels points Start / Via / End and removes, moves and clears them', async () => {
    const user = userEvent.setup();
    const props = setup({ points: [A, V, B], hasConsumption: true });
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Via 1')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    expect(screen.getByText('-26.2041, 28.0473')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Via 1' }));
    expect(props.onRemove).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole('button', { name: 'Move End up' }));
    expect(props.onMove).toHaveBeenCalledWith(2, -1);
    expect(screen.getByRole('button', { name: 'Move Start up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move End down' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(props.onClear).toHaveBeenCalled();
  });
});
