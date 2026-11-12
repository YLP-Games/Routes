import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LatLng, RouteRequest } from './shared/types';
import { App } from './App';
import { jsonResponse, polo, sampleResponse } from './components/__tests__/fixtures';

// maplibre-gl needs WebGL, which jsdom lacks: replace the map with a stub that adds points.
vi.mock('./components/MapView', () => ({
  MapView: ({
    points,
    stale,
    onAddPoint,
    onInsertPoint,
  }: {
    points: LatLng[];
    stale?: boolean;
    onAddPoint: (p: LatLng) => void;
    onInsertPoint: (index: number, p: LatLng) => void;
  }) => (
    <div data-testid="map" data-stale={String(!!stale)} data-points={points.length}>
      <button type="button" onClick={() => onAddPoint([{ lat: -26.2, lng: 28.0 }, { lat: -26.1, lng: 28.1 }, { lat: -26.0, lng: 28.2 }][points.length % 3])}>
        Add test point
      </button>
      <button type="button" onClick={() => onInsertPoint(1, { lat: -26.15, lng: 28.05 })}>
        Click the line
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
    if (url === `/api/vehicles/${polo.id}`) return jsonResponse(polo);
    if (url.startsWith('/api/vehicles/')) return jsonResponse({ error: { code: 'VEHICLE_NOT_FOUND', message: 'Unknown vehicle' } }, 404);
    if (url.startsWith('/api/vehicles')) return jsonResponse([]);
    if (url.startsWith('/api/places')) return jsonResponse([{ name: 'Sandton', detail: 'Johannesburg, Gauteng', lat: -26.1076, lng: 28.0567 }]);
    if (url === '/api/route' && init?.method === 'POST') return routeHandler(JSON.parse(String(init.body)));
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const routeCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  (fetchMock.mock.calls as FetchArgs[]).filter(([url]) => url === '/api/route');

async function prepareTrip(user: ReturnType<typeof userEvent.setup>) {
  // The map is a separate chunk, so it appears a moment after the panel.
  await user.click(await screen.findByRole('button', { name: 'Add test point' }));
  await user.click(screen.getByRole('button', { name: 'Add test point' }));
  await user.click(screen.getByLabelText('Enter my own consumption'));
  await user.type(screen.getByLabelText('Consumption (L/100 km)'), '7.4');
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // The planner mirrors the trip into the URL fragment; start every test from a clean address.
    window.history.replaceState(null, '', '/');
  });

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

  it('marks the result out of date when any input changes, and clears the mark when it is put back', async () => {
    const fetchMock = stubFetch(() => jsonResponse(sampleResponse));
    const user = userEvent.setup();
    render(<App />);
    await prepareTrip(user);
    await user.click(screen.getByRole('button', { name: 'Calculate trip' }));
    await screen.findByTestId('travel-time');
    const staleNote = () => screen.queryByText(/Your trip details changed/);
    expect(staleNote()).not.toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveAttribute('data-stale', 'false');

    // Fuel grade: the cost on screen is for Petrol 95, the form now says Petrol 93.
    await user.selectOptions(screen.getByLabelText('Fuel'), 'petrol93');
    expect(staleNote()).toBeInTheDocument();
    expect(screen.getByTestId('map')).toHaveAttribute('data-stale', 'true');
    expect(screen.getByRole('button', { name: 'Update trip' })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Fuel'), 'petrol95');
    expect(staleNote()).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calculate trip' })).toBeEnabled();

    // Zone, consumption, comparison, departure and the points each do the same.
    await user.selectOptions(screen.getByLabelText('Price zone'), 'coastal');
    expect(staleNote()).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Price zone'), 'inland');
    expect(staleNote()).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Consumption (L/100 km)'), '5');
    expect(staleNote()).toBeInTheDocument(); // 7.45
    await user.type(screen.getByLabelText('Consumption (L/100 km)'), '{Backspace}');
    expect(staleNote()).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Compare with the fastest route'));
    expect(staleNote()).toBeInTheDocument();
    await user.click(screen.getByLabelText('Compare with the fastest route'));
    expect(staleNote()).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Depart at'));
    expect(staleNote()).toBeInTheDocument();
    await user.click(screen.getByLabelText('Leave now'));
    expect(staleNote()).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add test point' }));
    expect(staleNote()).toBeInTheDocument();
    expect(routeCalls(fetchMock)).toHaveLength(1);

    // Updating recalculates for the inputs now on screen and clears the mark.
    await user.click(screen.getByRole('button', { name: 'Update trip' }));
    await waitFor(() => expect(staleNote()).not.toBeInTheDocument());
    expect(routeCalls(fetchMock)).toHaveLength(2);
    expect(JSON.parse(String(routeCalls(fetchMock)[1][1]?.body)).points).toHaveLength(3);
  });

  it('does not recalculate on a price-month toggle while other changes are waiting', async () => {
    const fetchMock = stubFetch(() => jsonResponse(sampleResponse));
    const user = userEvent.setup();
    render(<App />);
    await prepareTrip(user);
    await user.click(screen.getByRole('button', { name: 'Calculate trip' }));
    await screen.findByTestId('travel-time');

    await user.selectOptions(screen.getByLabelText('Price zone'), 'coastal');
    await user.click(screen.getByLabelText(/Last month/));
    expect(routeCalls(fetchMock)).toHaveLength(1);
    expect(screen.getByText(/Your trip details changed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Update trip' }));
    await waitFor(() => expect(routeCalls(fetchMock)).toHaveLength(2));
    expect(JSON.parse(String(routeCalls(fetchMock)[1][1]?.body))).toMatchObject({ zone: 'coastal', priceMonth: 'previous' });
  });

  it('brings a new result into view, but not a re-priced one', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      stubFetch(() => jsonResponse(sampleResponse));
      const user = userEvent.setup();
      render(<App />);
      await prepareTrip(user);
      await user.click(screen.getByRole('button', { name: 'Calculate trip' }));
      await screen.findByTestId('travel-time');
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByTestId('travel-time').closest('.results'));

      await user.click(screen.getByLabelText(/Last month/));
      await waitFor(() => expect(screen.getByLabelText(/Last month/)).toBeChecked());
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('adds a searched place as a named point and a clicked line as a via point in between', async () => {
    const fetchMock = stubFetch(() => jsonResponse(sampleResponse));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Search for a starting place'), 'sand');
    await user.click(await screen.findByRole('button', { name: /Sandton/ }));
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Sandton')).toBeInTheDocument();
    expect((fetchMock.mock.calls as FetchArgs[]).some(([url]) => url === '/api/places?q=sand')).toBe(true);
    expect(screen.getByLabelText('Search for a destination')).toHaveValue('');

    await user.click(await screen.findByRole('button', { name: 'Add test point' })); // End: -26.1, 28.1
    await user.click(screen.getByRole('button', { name: 'Click the line' }));
    expect(screen.getByText('Via 1')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(rows[0]).toContain('Sandton');
    expect(rows[1]).toContain('-26.1500, 28.0500');
    expect(rows[2]).toContain('-26.1000, 28.1000');

    await user.click(screen.getByLabelText('Enter my own consumption'));
    await user.type(screen.getByLabelText('Consumption (L/100 km)'), '7.4');
    await user.click(screen.getByRole('button', { name: 'Calculate trip' }));
    await screen.findByTestId('travel-time');
    // Place names are for display: only coordinates are sent.
    expect(JSON.parse(String(routeCalls(fetchMock)[0][1]?.body)).points).toEqual([
      { lat: -26.1076, lng: 28.0567 },
      { lat: -26.15, lng: 28.05 },
      { lat: -26.1, lng: 28.1 },
    ]);
  });

  it('mirrors the trip into the address bar and copies it as a link', async () => {
    stubFetch(() => jsonResponse(sampleResponse));
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<App />);
    expect(window.location.hash).toBe('');
    await prepareTrip(user);
    await waitFor(() => expect(decodeURIComponent(window.location.hash)).toBe('#p=-26.2,28;-26.1,28.1&c=7.4'));

    await user.click(screen.getByRole('button', { name: 'Calculate trip' }));
    await user.click(await screen.findByRole('button', { name: 'Copy link to this trip' }));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText('Link copied.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear route' }));
    await waitFor(() => expect(decodeURIComponent(window.location.hash)).toBe('#c=7.4'));
  });

  it('restores a trip from a link and calculates it once the car has loaded', async () => {
    window.history.replaceState(null, '', `/#p=-26.2041,28.0473~Johannesburg;-25.7479,28.2293&car=${polo.id}&z=coastal&m=previous&cmp=0`);
    const fetchMock = stubFetch(() => jsonResponse(sampleResponse));
    render(<App />);

    expect(screen.getByText('Johannesburg')).toBeInTheDocument();
    expect(screen.getByText('-25.7479, 28.2293')).toBeInTheDocument();
    expect(await screen.findByText('Volkswagen Polo Vivo 1.4 Trendline')).toBeInTheDocument();
    expect(await screen.findByTestId('travel-time')).toHaveTextContent('48 min');
    expect(routeCalls(fetchMock)).toHaveLength(1);
    expect(JSON.parse(String(routeCalls(fetchMock)[0][1]?.body))).toEqual({
      points: [{ lat: -26.2041, lng: 28.0473 }, { lat: -25.7479, lng: 28.2293 }],
      vehicleId: polo.id,
      fuel: 'petrol95',
      zone: 'coastal',
      priceMonth: 'previous',
      compareFastest: false,
    });
    expect(screen.getByLabelText('Price zone')).toHaveValue('coastal');
    expect(screen.getByLabelText(/Last month/)).toBeChecked();
    expect(screen.getByLabelText('Compare with the fastest route')).not.toBeChecked();
    expect(screen.queryByText(/Your trip details changed/)).not.toBeInTheDocument();
    // The link survives the round trip.
    expect(decodeURIComponent(window.location.hash)).toContain(`car=${polo.id}`);
  });

  it('restores what it can from a link with an unknown car and asks for one', async () => {
    window.history.replaceState(null, '', '/#p=-26.2,28;-26.1,28.1&car=no-such-car');
    const fetchMock = stubFetch(() => jsonResponse(sampleResponse));
    render(<App />);
    expect(await screen.findByText(/The car in this link could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Calculate trip' })).toBeDisabled();
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
