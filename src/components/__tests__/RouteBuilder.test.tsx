import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouteBuilder, type RouteBuilderProps } from '../RouteBuilder';

const A = { lat: -26.2041, lng: 28.0473 };
const V = { lat: -26.1, lng: 28.05 };
const B = { lat: -25.7479, lng: 28.2293 };

function setup(overrides: Partial<RouteBuilderProps> = {}) {
  const props: RouteBuilderProps = {
    points: [],
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<RouteBuilder {...props} />);
  return props;
}

describe('RouteBuilder', () => {
  it('explains how to add points and shows no list or Clear button before there are any', () => {
    setup();
    expect(screen.getByText(/click the map to add points in order/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear route' })).not.toBeInTheDocument();
  });

  it('shows a place name instead of coordinates for a searched point', () => {
    setup({ points: [{ ...A, label: 'Johannesburg' }, B] });
    expect(screen.getByText('Johannesburg')).toHaveAttribute('title', 'Johannesburg (-26.2041, 28.0473)');
    expect(screen.queryByText('-26.2041, 28.0473')).not.toBeInTheDocument();
    expect(screen.getByText('-25.7479, 28.2293')).toBeInTheDocument();
  });

  it('labels points Start / Via / End and removes, moves and clears them', async () => {
    const user = userEvent.setup();
    const props = setup({ points: [A, V, B] });
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

    await user.click(screen.getByRole('button', { name: 'Clear route' }));
    expect(props.onClear).toHaveBeenCalled();
  });
});
