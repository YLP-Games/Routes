/**
 * MapLibre map: click to add route points, drag numbered markers to move them,
 * right-click / long-press a marker to remove it. Draws the user's route (solid) and the
 * provider's fastest route (dashed grey). All maplibre-gl code lives in this file so tests
 * can replace the whole component with a stub.
 */
import { useEffect, useRef, useState } from 'react';
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type GeoJSONSource,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import type { LatLng } from '../shared/types';

export interface MapViewProps {
  points: LatLng[];
  geometry?: LatLng[];
  fastestGeometry?: LatLng[];
  onAddPoint: (p: LatLng) => void;
  onMovePoint: (index: number, p: LatLng) => void;
  onRemovePoint: (index: number) => void;
}

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_URL: string = import.meta.env.VITE_TILE_URL || DEFAULT_TILE_URL;
const JOHANNESBURG: [number, number] = [28.0473, -26.2041];
const LONG_PRESS_MS = 600;

const ROUTE_COLOUR = '#0b6bcb';
const FASTEST_COLOUR = '#7b8794';

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

export function MapView({ points, geometry, fastestGeometry, onAddPoint, onMovePoint, onRemovePoint }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Keep latest callbacks in refs so map/marker listeners never go stale.
  const callbacks = useRef({ onAddPoint, onMovePoint, onRemovePoint });
  callbacks.current = { onAddPoint, onMovePoint, onRemovePoint };

  // Create / destroy the map.
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: JOHANNESBURG,
      zoom: 10,
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      map.addSource('fastest-route', { type: 'geojson', data: lineFeature(undefined) });
      map.addSource('your-route', { type: 'geojson', data: lineFeature(undefined) });
      map.addLayer({
        id: 'fastest-route-line',
        type: 'line',
        source: 'fastest-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': FASTEST_COLOUR, 'line-width': 4, 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
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

    map.on('click', (e: MapMouseEvent) => {
      const target = e.originalEvent?.target as Element | null;
      if (target?.closest?.('.route-marker')) return; // clicks on markers are not new points
      callbacks.current.onAddPoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
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

  // Update route lines.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    (map.getSource('your-route') as GeoJSONSource | undefined)?.setData(lineFeature(geometry));
    (map.getSource('fastest-route') as GeoJSONSource | undefined)?.setData(lineFeature(fastestGeometry));
  }, [geometry, fastestGeometry, loaded]);

  // Fit to a newly arrived result.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geometry || geometry.length < 2) return;
    const bounds = new LngLatBounds();
    [...geometry, ...(fastestGeometry ?? [])].forEach((p) => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: 56, duration: 600, maxZoom: 16 });
  }, [geometry, fastestGeometry]);

  const hasRoute = !!geometry && geometry.length > 1;
  const hasFastest = !!fastestGeometry && fastestGeometry.length > 1;

  return (
    <div className="map-view">
      <div ref={containerRef} className="map-canvas" role="region" aria-label="Route map. Click to add points." />
      {hasRoute && (
        <div className="map-legend" aria-hidden="true">
          <span className="legend-item">
            <span className="legend-swatch legend-swatch--yours" /> Your route
          </span>
          {hasFastest && (
            <span className="legend-item">
              <span className="legend-swatch legend-swatch--fastest" /> Fastest route
            </span>
          )}
        </div>
      )}
    </div>
  );
}
