import "./status.css";

export interface SpinnerProps {
  readonly label?: string;
}

export function Spinner({ label }: SpinnerProps) {
  const glyph = (
    <svg
      aria-hidden="true"
      className="cv-spinner"
      fill="none"
      height="12"
      viewBox="0 0 12 12"
      width="12"
    >
      <circle cx="6" cy="6" opacity="0.25" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 1a5 5 0 0 1 5 5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  );
  if (label === undefined) return glyph;
  return (
    <span aria-label={label} className="cv-spinner-status" role="status">
      {glyph}
    </span>
  );
}
