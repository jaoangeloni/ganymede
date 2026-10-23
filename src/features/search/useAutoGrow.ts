import { type RefObject, useEffect, useLayoutEffect } from "react";

function autoGrow(element: HTMLTextAreaElement, max = Infinity) {
  element.style.height = "";
  if (!element.value) return;
  element.style.height = "0px";
  element.style.height = `${Math.min(element.scrollHeight, max)}px`;
}

export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, max: number) {
  useLayoutEffect(() => {
    if (ref.current) autoGrow(ref.current, max);
  }, [ref, value, max]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      autoGrow(element, max);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, max]);
}
