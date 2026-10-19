import { render, screen } from '@testing-library/react';
import { TripSummary, comparisonText } from '../TripSummary';
import { FuelCostCard } from '../FuelCostCard';
import { Warnings } from '../Warnings';
import { fastestRoute, yourRoute } from './fixtures';

describe('TripSummary', () => {
  it('renders the route figures without a fastest route', () => {
    render(<TripSummary yourRoute={yourRoute} />);
    expect(screen.getByTestId('travel-time')).toHaveTextContent('48 min');
    expect(screen.getAllByText('32.4 km').length).toBeGreaterThan(0);
    expect(screen.getByText('08:18')).toBeInTheDocument(); // arrival
    expect(screen.getByText('07:30')).toBeInTheDocument(); // departure
    expect(screen.getByText('35 min')).toBeInTheDocument(); // no traffic
    expect(screen.getByTestId('traffic-delay')).toHaveTextContent('+13 min');
    expect(screen.getByTestId('traffic-delay')).toHaveClass('stat--warning');
    expect(screen.queryByText(/fastest route/i)).not.toBeInTheDocument();
  });

  it('does not highlight a short traffic delay', () => {
    render(<TripSummary yourRoute={{ ...yourRoute, trafficDelaySeconds: 120 }} />);
    expect(screen.getByTestId('traffic-delay')).toHaveTextContent('+2 min');
    expect(screen.getByTestId('traffic-delay')).not.toHaveClass('stat--warning');
  });

  it('compares with the fastest route', () => {
    render(<TripSummary yourRoute={yourRoute} fastestRoute={fastestRoute} />);
    expect(screen.getByText('Your route is 6 min slower and R 12.40 more than the fastest route.')).toBeInTheDocument();
    expect(screen.getByText(/Fastest route: 42 min · 28.1 km · R 42.49/)).toBeInTheDocument();
  });

  it('describes a faster and cheaper route', () => {
    expect(comparisonText(fastestRoute, yourRoute)).toBe('Your route is 6 min faster and R 12.40 cheaper than the fastest route.');
    expect(comparisonText(yourRoute, yourRoute)).toMatch(/about the same/);
  });
});

describe('FuelCostCard', () => {
  it('renders the fuel figures', () => {
    render(<FuelCostCard fuel={yourRoute.fuel} fuelDescription="Petrol 95 · Inland" />);
    expect(screen.getByTestId('fuel-cost')).toHaveTextContent('R 54.89');
    expect(screen.getByText('R 1.69 per km')).toBeInTheDocument();
    expect(screen.getByText('2.4 L')).toBeInTheDocument();
    expect(screen.getByText('7.4 L/100 km')).toBeInTheDocument();
    expect(screen.getByText(/R 22.86\/L · October 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Petrol 95 · Inland/)).toBeInTheDocument();
    expect(screen.getByText(/Estimate — real use varies with driving style, load and aircon\./)).toBeInTheDocument();
    expect(screen.queryByText(/simplified estimate/)).not.toBeInTheDocument();
  });

  it('flags the fallback method', () => {
    render(<FuelCostCard fuel={{ ...yourRoute.fuel, method: 'fallback-average' }} />);
    expect(screen.getByText(/\(simplified estimate\)/)).toBeInTheDocument();
  });
});

describe('Warnings', () => {
  it('renders nothing when empty and lists warnings otherwise', () => {
    const { container, rerender } = render(<Warnings warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Warnings warnings={['Demo mode']} />);
    expect(screen.getByRole('status')).toHaveTextContent('Demo mode');
  });
});
