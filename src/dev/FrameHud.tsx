import { useEffect, useRef, useState } from "react";

const WINDOW_MS = 2000;
const LONG_MS = 50;

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

export function FrameHud() {
  const [on, setOn] = useState(() => {
    try {
      return new URLSearchParams(location.search).has("hud") || localStorage.getItem("ganymede:hud") === "1";
    } catch {
      return false;
    }
  });
  const text = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "F9") return;
      setOn((current) => {
        try {
          localStorage.setItem("ganymede:hud", current ? "0" : "1");
        } catch {}
        return !current;
      });
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  useEffect(() => {
    if (!on) return;
    const frames: { at: number; ms: number }[] = [];
    let last = 0;
    let written = 0;
    let request = requestAnimationFrame(function tick(now) {
      if (last) frames.push({ at: now, ms: now - last });
      last = now;
      while (frames.length && now - frames[0].at > WINDOW_MS) frames.shift();
      if (now - written > 500 && text.current) {
        written = now;
        const sorted = frames.map((frame) => frame.ms).sort((a, b) => a - b);
        const mean = sorted.reduce((sum, ms) => sum + ms, 0) / (sorted.length || 1);
        const map = document.querySelector('[data-drop="canvas"]');
        const f = (ms: number) => ms.toFixed(1).padStart(6);
        text.current.textContent = [
          `frame  mean ${f(mean)}  p95 ${f(percentile(sorted, 0.95))}  p99 ${f(percentile(sorted, 0.99))}  max ${f(sorted.at(-1) ?? 0)} ms`,
          `${String(Math.round((1000 * sorted.length) / WINDOW_MS)).padStart(3)} fps   > ${LONG_MS} ms: ${sorted.filter((ms) => ms > LONG_MS).length}`,
          map?.querySelector<HTMLElement>("[data-stats]")?.dataset.stats ?? "map  out of view",
        ].join("\n");
      }
      request = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(request);
  }, [on]);

  if (!on) return null;
  return (
    <pre
      ref={text}
      className="pointer-events-none fixed top-2 right-2 z-[9999] rounded-md bg-fg/85 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-bg tabular-nums"
    />
  );
}
