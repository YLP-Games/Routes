import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LatLng, RouteRequest } from './shared/types';
import { App } from './App';
import { jsonResponse, sampleResponse } from './components/__tests__/fixtures';

// maplibre-gl needs WebGL, which jsdom lacks: replace the map with a stub that adds points.
vi.mock('./components/MapView', () => ({
  MapView: ({ points, onAddPoint }: { points: LatLng[]; onAddPoint: (p: LatLng) => void }) => (
    <div data-testid="map">
      <button type="button" onClick={() => onAddPoint([{ lat: -26.2, lng: 28.0 }, { lat: -26.1, lng: 28.1 }, { lat: -26.0, lng: 28.2 }][points.length % 3])}>
        Add test point
      </button>
    </div>
  ),
}));

type FetchArgs = [string, RequestInit | undefined];

function stubFetch(routeHandler: (body: RouteRequest) => Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/health') return jsonResponse({ ok: true, provider: 'mock' });
    if (url === '/api/fuel-prices/months') return jsonResponse(['2026-11', '2026-10', '2026-09']);
    // 'current' is what the server resolves (newest month already in effect), not months[0].
    if (url === '/api/fuel-prices?month=current') return jsonResponse([{ month: '2026-10' }]);
    if (url === '/api/fuel-prices?month=previous') return jsonResponse([{ month: '2026-09' }]);
    if (url.startsWith('/api/vehicles')) return jsonResponse([]);
    if (url === '/api/route' && init?.method === 'POST') return routeHandler(JSON.parse(String(init.body)));
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const routeCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  (fetchMock.mock.calls as FetchArgs[]).filter(([url]) => url === '/api/route');

async function prepareTrip(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add test point' }));
  await user.click(screen.getByRole('button', { name: 'Add test point' }));
  await user.click(screen.getByLabelText('Enter my own consumption'));
  await user.type(screen.getByLabelText('Consumption (L/100 km)'), '7.4');
}

describe('App', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calculates a trip from map points and custom consumption', async () => {
    const fetchMock = stubFetch(() => jsonResponse(sampleResponse));
    const user = userEvent.setup();
    render(<App />);

    const calc = screen.getByRole('button', { name: 'Calculate trip' });
    expect(calc).toBeDisabled();
    await prepareTrip(user);
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('End')).toBeInTheDocument();
    expect(calc).toBeEnabled();

    // Month names come from /api/fuel-prices/months.
    expect(await screen.findByText('October 2026')).toBeInTheDocument();
    expect(screen.getByText('September 2026')).toBeInTheDocument();
    expect(await screen.findByText('Demo mode')).toBeInTheDocument();

    await user.click(calc);

    expect(await screen.findByTestId('travel-time')).toHaveTextContent('48 min');
    const calls = routeCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [, init] = calls[0];
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init?.body)) as RouteRequest;
    expect(body).toEqual({
      points: [
        { lat: -26.2, lng: 28.0 },
        { lat: -26.1, lng: 28.1 },
      ],
      fuel: 'petrol95',
      zone: 'inland',
      priceMonth: 'current',
      compareFastest: true,
      customConsumptionL100km: 7.4,
    });
    expect(body.vehicleId).toBeUndefined();
    expect(body.departAt).toBeUndefined();

    expect(screen.getByTestId('fuel-cost')).toHaveTextContent('R 54.89');
    expect(screen.getByText('Your route is 6 min slower and R 12.40 more than the fastest route.')).toBeInTheDocument();
    expect(within(screen.getByRole('status')).getByText('Demo mode: traffic data is simulated.')).toBeInTheDocument();
  });

  it('recalculates when the price month is toggled after a result', async () => {
    const fetchMock = stubFetch((body) =>
      jsonResponse({
        ...sampleResponse,
        yourRoute: {
          ...sampleResponse.yourRoute,
          fuel: { ...sampleResponse.yourRoute.fuel, priceMonth: body.priceMonth === 'previous' ? '2026-09' : '2026-10' },
        },
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await prepareTrip(user);
    await user.click(screen.getByRole('button', { name: 'Calculate trip' }));
    expect(await screen.findByText(/R 22.86\/L · October 2026/)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Last month/));
    expect(await screen.findByText(/R 22.86\/L · September 2026/)).toBeInTheDocument();
    const calls = routeCalls(fetchMock);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1][1]?.body)).priceMonth).toBe('previous');
  });

  it('does not call the API when toggling month before any result', async () => {
    const fetchMock = stubFetch(() => jsonResponse(sampleResponse));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText(/Last month/));
    expect(routeCalls(fetchMock)).toHaveLength(0);
  });

  it('shows the API error message', async () => {
    stubFetch(() => jsonResponse({ error: { code: 'BAD_REQUEST', message: 'points must contain at least 2 items' } }, 400));
    const user = userEvent.setup();
    render(<App />);
    await prepareTrip(user);
    await user.click(screen.getByRole('button', { name: 'Calculate trip' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('points must contain at least 2 items');
    expect(screen.queryByTestId('travel-time')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Calculate trip' })).toBeEnabled());
  });

  it('shows a network error when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await prepareTrip(user);
    await user.click(screen.getByRole('button', { name: 'Calculate trip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the Routes server/);
  });
});
