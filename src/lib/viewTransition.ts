import { flushSync } from "react-dom";

export async function crossfade(update: () => void, onFinished?: () => void) {
  if (!document.startViewTransition) {
    update();
    return onFinished?.();
  }
  const transition = document.startViewTransition(() => flushSync(update));
  if (onFinished) void transition.finished.finally(onFinished);
  await transition.updateCallbackDone;
}

export function morphing(on: boolean, update: () => void, onFinished?: () => void) {
  if (!on) return crossfade(update, onFinished);
  const root = document.documentElement;
  root.dataset.morph = "";
  return crossfade(update, () => {
    delete root.dataset.morph;
    onFinished?.();
  });
}

export function reflow(update: () => void) {
  const root = document.documentElement;
  root.dataset.reflow = "";
  void crossfade(update, () => delete root.dataset.reflow);
}
