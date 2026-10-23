import { useId } from "react";

export function Mark({ size }: { size: number }) {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0.85" y1="0.1" x2="0.15" y2="0.95">
          <stop offset="0" stopColor="#8a7dff" />
          <stop offset="1" stopColor="#4a3bdb" />
        </linearGradient>
      </defs>
      <circle cx="10.2" cy="13.8" r="8" fill={`url(#${id})`} />
      <circle cx="16.6" cy="7.8" r="4.4" className="fill-primary" />
    </svg>
  );
}
