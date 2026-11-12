import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionBar, type ActionBarProps } from '../ActionBar';

function setup(overrides: Partial<ActionBarProps> = {}) {
  const props: ActionBarProps = { pointCount: 0, hasConsumption: false, onCalculate: vi.fn(), ...overrides };
  render(<ActionBar {...props} />);
  return props;
}

const button = () => screen.getByRole('button');

describe('ActionBar', () => {
  it('is disabled with no points and says what to add', () => {
    setup({ hasConsumption: true });
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent('Calculate trip');
    expect(screen.getByText('Add a start and an end point on the map.')).toBeInTheDocument();
    expect(button()).toHaveAccessibleDescription('Add a start and an end point on the map.');
  });

  it('stays disabled with one point', () => {
    setup({ pointCount: 1, hasConsumption: true });
    expect(button()).toBeDisabled();
    expect(screen.getByText('Add an end point on the map.')).toBeInTheDocument();
  });

  it('stays disabled without a vehicle or consumption', () => {
    setup({ pointCount: 2, hasConsumption: false });
    expect(button()).toBeDisabled();
    expect(screen.getByText(/Choose your car/)).toBeInTheDocument();
  });

  it('is enabled with two points and consumption', async () => {
    const props = setup({ pointCount: 2, hasConsumption: true });
    expect(button()).toBeEnabled();
    expect(screen.getByText('Ready when you are.')).toBeInTheDocument();
    await userEvent.click(button());
    expect(props.onCalculate).toHaveBeenCalledTimes(1);
  });

  it('is disabled while calculating', () => {
    setup({ pointCount: 2, hasConsumption: true, calculating: true });
    expect(button()).toBeDisabled();
    expect(button()).toHaveTextContent('Calculating…');
  });

  it('shows the answer beside the button while it is current', () => {
    setup({ pointCount: 3, hasConsumption: true, summary: { duration: '1 h 05 min', cost: 'R 145.07' } });
    expect(screen.getByTestId('bar-summary')).toHaveTextContent('1 h 05 min · R 145.07');
    expect(button()).toHaveTextContent('Calculate trip');
  });

  it('offers "Update trip" and hides the old answer when the result is out of date', () => {
    setup({ pointCount: 2, hasConsumption: true, stale: true, summary: { duration: '1 h 05 min', cost: 'R 145.07' } });
    expect(screen.getByRole('button', { name: 'Update trip' })).toBeEnabled();
    expect(screen.queryByTestId('bar-summary')).not.toBeInTheDocument();
    expect(screen.getByText('Trip details changed since the last calculation.')).toBeInTheDocument();
  });

  it('keeps asking for what is missing even when an old result exists', () => {
    setup({ pointCount: 2, hasConsumption: false, stale: true, summary: { duration: '48 min', cost: 'R 54.89' } });
    expect(button()).toBeDisabled();
    expect(screen.getByText(/Choose your car/)).toBeInTheDocument();
    expect(screen.queryByTestId('bar-summary')).not.toBeInTheDocument();
  });
});
