/**
 * MapLibre map: click to add route points, click the route line to add a via point in between,
 * drag numbered markers to move them, right-click / long-press a marker to remove it. Draws the
 * user's route (solid), the provider's fastest route (dashed grey) and, until a route has been
 * calculated for the current points, a straight-line sketch through them. All maplibre-gl code
 * lives in this file so it loads as its own chunk and tests can replace the whole component.
 */
import { useEffect, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre-gl derives its worker URL from its own import.meta.url at runtime, which breaks once
// Vite relocates the library (dev dep optimizer: /node_modules/.vite/deps/; build: dist/assets/
// without the worker file). Hand it the worker as a Vite-managed asset URL instead.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { LatLng } from '../shared/types';
import { insertionIndex } from '../lib/geo';

setWorkerUrl(maplibreWorkerUrl);

export interface MapViewProps {
  points: LatLng[];
  geometry?: LatLng[];
  fastestGeometry?: LatLng[];
  /** True when the drawn route no longer matches the points or options: it is faded out. */
  stale?: boolean;
  onAddPoint: (p: LatLng) => void;
  /** A click on the route line: insert `p` so that it becomes point number `index`. */
  onInsertPoint: (index: number, p: LatLng) => void;
  onMovePoint: (index: number, p: LatLng) => void;
  onRemovePoint: (index: number) => void;
}

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_URL: string = import.meta.env.VITE_TILE_URL || DEFAULT_TILE_URL;
const JOHANNESBURG: [number, number] = [28.0473, -26.2041];
const LONG_PRESS_MS = 600;
/** A click this close to the line (px) counts as a click on it. */
const LINE_HIT_PX = 7;
/** Room for the legend at the bottom when fitting the view to a route. */
const FIT_PADDING = { top: 56, right: 56, bottom: 84, left: 56 };

/** The one accent of the interface (styles.css --accent): the user's route. */
const ROUTE_COLOUR = '#0d7480';
const FASTEST_COLOUR = '#5d6b72';
/** Layers a click can land on to insert a via point. */
const LINE_LAYERS = ['your-route-line', 'sketch-line'];

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: 'raster',
      tiles: [TILE_URL],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'base', type: 'raster', source: 'base' }],
};

/** GeoJSON accepted by GeoJSONSource#setData (avoids depending on @types/geojson directly). */
type GeoJSONData = Parameters<GeoJSONSource['setData']>[0];

function lineFeature(points: LatLng[] | undefined): GeoJSONData {
  if (!points || points.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
      },
    ],
  };
}

function boundsOf(points: LatLng[]): LngLatBounds {
  const bounds = new LngLatBounds();
  points.forEach((p) => bounds.extend([p.lng, p.lat]));
  return bounds;
}

function markerLabel(index: number, count: number): string {
  if (index === 0) return 'A';
  if (index === count - 1) return 'B';
  return String(index);
}

function markerKind(index: number, count: number): 'start' | 'end' | 'via' {
  if (index === 0) return 'start';
  if (index === count - 1) return 'end';
  return 'via';
}

export function MapView({ points, geometry, fastestGeometry, stale = false, onAddPoint, onInsertPoint, onMovePoint, onRemovePoint }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Keep the latest callbacks and points in refs so map/marker listeners never go stale.
  const callbacks = useRef({ onAddPoint, onInsertPoint, onMovePoint, onRemovePoint });
  callbacks.current = { onAddPoint, onInsertPoint, onMovePoint, onRemovePoint };
  const pointsRef = useRef(points);
  pointsRef.current = points;
  /** Points as of the previous render, to tell which ones are new. */
  const previousPoints = useRef<LatLng[]>([]);
  /** The result bounds the view was last fitted to, so an identical result does not move the map again. */
  const fittedTo = useRef('');

  // Create / destroy the map.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: JOHANNESBURG,
      zoom: 10,
      // Always written out: the collapsed form is a 24px toggle, too small to tap on a phone.
      attributionControl: { compact: false },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      for (const id of ['fastest-route', 'sketch', 'your-route']) map.addSource(id, { type: 'geojson', data: lineFeature(undefined) });
      map.addLayer({
        id: 'fastest-route-line',
        type: 'line',
        source: 'fastest-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': FASTEST_COLOUR, 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
      });
      map.addLayer({
        id: 'sketch-line',
        type: 'line',
        source: 'sketch',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE_COLOUR, 'line-width': 3, 'line-dasharray': [1, 2], 'line-opacity': 0.8 },
      });
      map.addLayer({
        id: 'your-route-casing',
        type: 'line',
        source: 'your-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.85 },
      });
      map.addLayer({
        id: 'your-route-line',
        type: 'line',
        source: 'your-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': ROUTE_COLOUR, 'line-width': 5 },
      });
      setLoaded(true);
    });

    /** True when the pointer is on the user's route or sketch line (which exist only after 'load'). */
    const onLine = (e: MapMouseEvent): boolean => {
      if (pointsRef.current.length < 2 || !map.getLayer('your-route-line')) return false;
      const { x, y } = e.point;
      const box: [[number, number], [number, number]] = [
        [x - LINE_HIT_PX, y - LINE_HIT_PX],
        [x + LINE_HIT_PX, y + LINE_HIT_PX],
      ];
      return map.queryRenderedFeatures(box, { layers: LINE_LAYERS }).length > 0;
    };

    map.on('click', (e: MapMouseEvent) => {
      const target = e.originalEvent?.target as Element | null;
      if (target?.closest?.('.route-marker')) return; // clicks on markers are not new points
      const p = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      if (onLine(e)) callbacks.current.onInsertPoint(insertionIndex(pointsRef.current, p), p);
      else callbacks.current.onAddPoint(p);
    });

    // Show that the line is clickable: a click there adds a via point instead of a new destination.
    map.on('mousemove', (e: MapMouseEvent) => {
      const cursor = onLine(e) ? 'copy' : '';
      const canvas = map.getCanvas();
      if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      previousPoints.current = [];
      fittedTo.current = '';
      setLoaded(false);
    };
  }, []);

  // Sync markers with points (recreated on every change: point lists are small).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    const cleanups: (() => void)[] = [];

    markersRef.current = points.map((p, index) => {
      const el = document.createElement('div');
      const kind = markerKind(index, points.length);
      el.className = `route-marker route-marker--${kind}`;
      el.textContent = markerLabel(index, points.length);
      el.title = `${kind === 'start' ? 'Start' : kind === 'end' ? 'End' : `Via ${index}`} — drag to move, right-click or long-press to remove`;
      el.setAttribute('aria-label', el.title);

      const onContextMenu = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        callbacks.current.onRemovePoint(index);
      };
      let pressTimer: ReturnType<typeof setTimeout> | undefined;
      const clearPress = () => {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = undefined;
      };
      const onTouchStart = () => {
        clearPress();
        pressTimer = setTimeout(() => callbacks.current.onRemovePoint(index), LONG_PRESS_MS);
      };
      el.addEventListener('contextmenu', onContextMenu);
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchend', clearPress);
      el.addEventListener('touchmove', clearPress, { passive: true });
      el.addEventListener('touchcancel', clearPress);
      cleanups.push(() => {
        clearPress();
        el.removeEventListener('contextmenu', onContextMenu);
        el.removeEventListener('touchstart', onTouchStart);
        el.removeEventListener('touchend', clearPress);
        el.removeEventListener('touchmove', clearPress);
        el.removeEventListener('touchcancel', clearPress);
      });

      const marker = new Marker({ element: el, draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
      marker.on('dragstart', clearPress);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        callbacks.current.onMovePoint(index, { lat: ll.lat, lng: ll.lng });
      });
      return marker;
    });

    return () => cleanups.forEach((fn) => fn());
  }, [points]);

  // Bring points into view when they arrive from outside the map: a place search or a trip link.
  // Points added by clicking or dragging are on screen already, so the view never moves under the cursor.
  useEffect(() => {
    const map = mapRef.current;
    const previous = previousPoints.current;
    previousPoints.current = points;
    if (!map || points.length === 0) return;
    const view = map.getBounds();
    const added = points.filter((p) => !previous.some((q) => q.lat === p.lat && q.lng === p.lng));
    if (added.every((p) => view.contains([p.lng, p.lat]))) return;
    if (points.length === 1) {
      map.easeTo({ center: [points[0].lng, points[0].lat], zoom: Math.max(map.getZoom(), 11), duration: 600 });
    } else {
      map.fitBounds(boundsOf(points), { padding: FIT_PADDING, duration: 600, maxZoom: 14 });
    }
  }, [points]);

  const hasRoute = !!geometry && geometry.length > 1;
  const hasFastest = !!fastestGeometry && fastestGeometry.length > 1;
  /** Until a route exists for the current points, a straight-line sketch shows their order. */
  const showSketch = points.length >= 2 && (!hasRoute || stale);

  // Update route lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource('your-route') as GeoJSONSource | undefined)?.setData(lineFeature(geometry));
    (map.getSource('fastest-route') as GeoJSONSource | undefined)?.setData(lineFeature(fastestGeometry));
    (map.getSource('sketch') as GeoJSONSource | undefined)?.setData(lineFeature(showSketch ? points : undefined));
    map.setPaintProperty('your-route-line', 'line-opacity', stale ? 0.3 : 1);
    map.setPaintProperty('your-route-casing', 'line-opacity', stale ? 0.3 : 0.85);
    map.setPaintProperty('fastest-route-line', 'line-opacity', stale ? 0.3 : 0.9);
  }, [points, geometry, fastestGeometry, showSketch, stale, loaded]);

  // Fit to a newly arrived result. The same result again (a re-priced trip) leaves the view alone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geometry || geometry.length < 2) return;
    const bounds = boundsOf([...geometry, ...(fastestGeometry ?? [])]);
    const key = bounds.toArray().flat().join(',');
    if (key === fittedTo.current) return;
    fittedTo.current = key;
    map.fitBounds(bounds, { padding: FIT_PADDING, duration: 600, maxZoom: 16 });
  }, [geometry, fastestGeometry]);

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" role="region" aria-label="Route map. Click to add points." />
      {(hasRoute || showSketch) && (
        <div className="map-legend" aria-hidden="true">
          {hasRoute && (
            <span className={`legend-item ${stale ? 'legend-item--stale' : ''}`}>
              <span className="legend-swatch legend-swatch--yours" /> Your route{stale ? ' (out of date)' : ''}
            </span>
          )}
          {hasFastest && !stale && (
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--fastest" /> Fastest route
            </span>
          )}
          {showSketch && (
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--sketch" /> Your points, not yet calculated
            </span>
          )}
        </div>
      )}
    </div>
  );
}
