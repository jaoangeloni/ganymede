export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const closest = <E extends Element = HTMLElement>(target: EventTarget | null, selector: string) =>
  target instanceof Element ? target.closest<E>(selector) : null;

export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.matches("input, textarea, [contenteditable]");
