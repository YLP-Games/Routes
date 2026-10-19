import { formatDistance, formatDuration, formatLatLng, formatLitres, formatMonth, formatRands, formatTime } from '../../lib/format';

describe('formatDuration', () => {
  it('formats minutes under an hour', () => {
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(89)).toBe('1 min');
  });
  it('formats hours with zero-padded minutes', () => {
    expect(formatDuration(65 * 60)).toBe('1 h 05 min');
    expect(formatDuration(2 * 3600 + 30 * 60)).toBe('2 h 30 min');
    expect(formatDuration(59 * 60 + 40)).toBe('1 h 00 min');
  });
  it('handles zero and tiny values', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(10)).toBe('< 1 min');
  });
});

describe('formatDistance', () => {
  it('uses metres below 1 km', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(0)).toBe('0 m');
  });
  it('uses km with one decimal', () => {
    expect(formatDistance(12_430)).toBe('12.4 km');
    expect(formatDistance(999.7)).toBe('1.0 km');
  });
  it('drops decimals and groups thousands for long trips', () => {
    expect(formatDistance(154_900)).toBe('155 km');
    expect(formatDistance(1_402_000)).toBe('1 402 km');
  });
});

describe('formatRands', () => {
  it('uses space thousands separator and dot decimal', () => {
    expect(formatRands(1234.5)).toBe('R 1 234.50');
    expect(formatRands(1_234_567.891)).toBe('R 1 234 567.89');
    expect(formatRands(12.4)).toBe('R 12.40');
    expect(formatRands(0)).toBe('R 0.00');
  });
  it('rounds to cents and handles negatives', () => {
    expect(formatRands(0.005)).toBe('R 0.01');
    expect(formatRands(-12.4)).toBe('-R 12.40');
    expect(formatRands(999.999)).toBe('R 1 000.00');
  });
});

describe('formatTime', () => {
  it('formats local HH:mm', () => {
    const d = new Date(2026, 9, 19, 7, 5);
    expect(formatTime(d.toISOString())).toBe('07:05');
  });
  it('returns a dash for invalid input', () => {
    expect(formatTime('nope')).toBe('–');
  });
});

describe('formatMonth', () => {
  it('formats YYYY-MM as month name and year', () => {
    expect(formatMonth('2026-10')).toBe('October 2026');
    expect(formatMonth('2026-01')).toBe('January 2026');
  });
  it('returns unrecognised input unchanged', () => {
    expect(formatMonth('current')).toBe('current');
    expect(formatMonth('2026-13')).toBe('2026-13');
  });
});

describe('small helpers', () => {
  it('formats coordinates and litres', () => {
    expect(formatLatLng({ lat: -26.20412, lng: 28.04731 })).toBe('-26.2041, 28.0473');
    expect(formatLitres(2.4013)).toBe('2.4 L');
  });
});
