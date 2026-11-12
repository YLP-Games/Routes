/** Interface glyphs, drawn in the text colour. One stroke weight and one 16px box, so they read as a set. */
const PATHS = {
  'arrow-up': 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
  'arrow-down': 'M8 3v10M3.5 8.5 8 13l4.5-4.5',
  close: 'M4 4l8 8M12 4l-8 8',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1',
  check: 'M3 8.5l3.2 3L13 4.5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Routes mark: a start and an end joined by a road. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="7" fill="var(--ink)" />
      <path d="M9 19c0-5 10-5 10-10" fill="none" stroke="var(--ground)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="9" cy="19.5" r="2.4" fill="var(--ground)" />
      <circle cx="19" cy="8.5" r="2.4" fill="var(--accent-on-ink)" />
    </svg>
  );
}
