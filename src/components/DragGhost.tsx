import { useEffect, useRef, useState } from "react";
import type { Reference } from "../types";
import { Picture } from "./Picture";

const TILT = { perSpeed: 9, max: 14, follow: 0.35, idleMs: 90 };

function useSwing(x: number) {
  const [tilt, setTilt] = useState(0);
  const last = useRef({ x, t: performance.now() });
  useEffect(() => {
    const now = performance.now();
    const speed = (x - last.current.x) / Math.max(16, now - last.current.t);
    last.current = { x, t: now };
    const target = Math.max(-TILT.max, Math.min(TILT.max, speed * TILT.perSpeed));
    setTilt((current) => current + (target - current) * TILT.follow);
    const timer = setTimeout(() => setTilt(0), TILT.idleMs);
    return () => clearTimeout(timer);
  }, [x]);
  return tilt;
}

export function DragGhost({ refs, x, y }: { refs: Reference[]; x: number; y: number }) {
  const tilt = useSwing(x);
  if (!refs.length) return null;
  const shown = refs.slice(0, 3);
  return (
    <div className="pointer-events-none fixed top-0 left-0 z-50" style={{ translate: `${x + 14}px ${y + 14}px` }}>
      <div
        className="relative size-14 origin-top-left animate-pop-in transition-[rotate] duration-300 ease-spring"
        style={{ rotate: `${tilt}deg` }}
      >
        {shown.map((ref, i) => (
          <div
            key={ref.id}
            className="absolute inset-0 overflow-hidden rounded-lg bg-skeleton shadow-float ring-2 ring-surface"
            style={{ rotate: `${(shown.length - 1 - i) * -7}deg`, zIndex: shown.length - i }}
          >
            <Picture reference={ref} sharp={false} />
          </div>
        ))}
        {refs.length > 1 && (
          <span
            key={refs.length}
            className="absolute -top-2 -right-2 z-10 grid h-5 min-w-5 animate-bump place-items-center rounded-full bg-fg px-1 text-[11px] text-bg tabular-nums"
          >
            {refs.length}
          </span>
        )}
      </div>
    </div>
  );
}
