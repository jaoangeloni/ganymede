import { type RefObject, useEffect } from "react";
import { reduceMotion } from "../../lib/platform";

const LAG = { step: 55, max: 18, rest: 0.25 };

export function useColumnLag(ref: RefObject<HTMLElement | null>, columns: number) {
  useEffect(() => {
    const element = ref.current;
    if (!element || columns < 2 || reduceMotion()) return;
    const scroller = scrollParent(element);
    if (!scroller) return;
    const middle = (columns - 1) / 2;
    const lag = Array.from({ length: columns }, (_, i) => Math.abs(i - middle) ** 0.7 * LAG.step);
    const offsets = new Array<number>(columns).fill(0);
    const write = () => {
      for (const item of element.querySelectorAll<HTMLElement>("[data-column]")) {
        const offset = offsets[Number(item.dataset.column)] ?? 0;
        item.style.transform = offset ? `translateY(${offset.toFixed(2)}px)` : "";
      }
    };
    let last = scroller.scrollTop;
    let frame = 0;
    let time = 0;
    const tick = (now: number) => {
      const dt = time ? Math.min(64, now - time) : 16;
      time = now;
      let moving = false;
      offsets.forEach((offset, i) => {
        const next = Math.abs(offset) < LAG.rest ? 0 : offset * Math.exp(-dt / lag[i]);
        offsets[i] = next;
        moving ||= next !== 0;
      });
      write();
      frame = moving ? requestAnimationFrame(tick) : 0;
      if (!moving) time = 0;
    };
    const onScroll = () => {
      const delta = scroller.scrollTop - last;
      last = scroller.scrollTop;
      offsets.forEach((offset, i) => (offsets[i] = lag[i] ? Math.max(-LAG.max, Math.min(LAG.max, offset + delta)) : 0));
      frame ||= requestAnimationFrame(tick);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      offsets.fill(0);
      write();
    };
  }, [ref, columns]);
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}
