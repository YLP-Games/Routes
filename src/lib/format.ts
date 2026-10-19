/**
 * Display formatting helpers. Implemented by hand (no Intl locale data) so output is identical
 * in browsers, Node and jsdom. South African conventions: space thousands separator, dot decimal.
 */
import type { LatLng } from '../shared/types';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Groups the integer part of a non-negative number string with spaces: "1234567" -> "1 234 567". */
function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 2700 -> "45 min", 3900 -> "1 h 05 min". Rounded to the nearest minute. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  if (seconds < 30) return '< 1 min';
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${pad2(minutes)} min`;
}

/** 850 -> "850 m", 12 430 -> "12.4 km", 154 900 -> "155 km". */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  const rounded = Math.round(meters);
  if (rounded < 1000) return `${rounded} m`;
  const km = meters / 1000;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${groupThousands(String(Math.round(km)))} km`;
}

/** 1234.5 -> "R 1 234.50"; -12.4 -> "-R 12.40". */
export function formatRands(amount: number): string {
  if (!Number.isFinite(amount)) return 'R –';
  const cents = Math.round(Math.abs(amount) * 100);
  const sign = amount < 0 && cents > 0 ? '-' : '';
  const intPart = groupThousands(String(Math.floor(cents / 100)));
  return `${sign}R ${intPart}.${pad2(cents % 100)}`;
}

/** ISO datetime -> "HH:mm" in the user's local time zone. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "2026-10" -> "October 2026". Unrecognised input is returned unchanged. */
export function formatMonth(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return month;
  return `${MONTH_NAMES[idx]} ${m[1]}`;
}

/** Short coordinate label: "-26.2041, 28.0473". */
export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
}

/** 3.456 -> "3.5 L". */
export function formatLitres(litres: number): string {
  return `${(Number.isFinite(litres) ? litres : 0).toFixed(1)} L`;
}
