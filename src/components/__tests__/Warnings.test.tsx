import { render, screen, within } from '@testing-library/react';
import { Warnings } from '../Warnings';

describe('Warnings', () => {
  it('renders nothing for an empty warning list', () => {
    const { container } = render(<Warnings warnings={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders each warning in a status banner', () => {
    const warnings = ['Demo mode: traffic data is simulated.', 'Prices are estimates.'];
    render(<Warnings warnings={warnings} />);

    const status = screen.getByRole('status');
    expect(within(status).getAllByRole('listitem')).toHaveLength(warnings.length);
    warnings.forEach((warning) => {
      expect(within(status).getByText(warning)).toBeInTheDocument();
    });
  });
});
