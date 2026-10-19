export interface WarningsProps {
  warnings: string[];
}

/** Banner listing server or app warnings (e.g. demo mode). Renders nothing when empty. */
export function Warnings({ warnings }: WarningsProps) {
  if (warnings.length === 0) return null;
  return (
    <div className="warnings" role="status">
      <ul>
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}
