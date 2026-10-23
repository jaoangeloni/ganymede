import { reduceMotion } from "./platform";
import { post } from "./windows";

const TYPE = "application/x-ganymede";
const BLANK = Object.assign(new Image(), {
  src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
});

type Payload = { refIds: string[] } | { collectionId: string } | { nodeIds: string[] };

export function startDrag(event: React.DragEvent, payload: Payload) {
  event.dataTransfer.setData(TYPE, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
}

export function carry(event: React.DragEvent, payload: Payload, refIds: string[]) {
  startDrag(event, payload);
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setDragImage(BLANK, 0, 0);
  post({ kind: "carry", refIds });
}

export const endCarry = () => post({ kind: "carry", refIds: null });

export function payloadOf(data: DataTransfer): Payload | null {
  const raw = data.getData(TYPE);
  return raw ? (JSON.parse(raw) as Payload) : null;
}

// WebKitGTK leaves relatedTarget null on dragleave, so leaving the window shows only as enters and leaves evening out
export function followDrag(over: (event: DragEvent) => void, gone: () => void): () => void {
  let depth = 0;
  const enter = () => void depth++;
  const leave = () => {
    depth = Math.max(0, depth - 1);
    if (!depth) gone();
  };
  const end = () => {
    depth = 0;
    gone();
  };
  window.addEventListener("dragover", over);
  window.addEventListener("dragenter", enter);
  window.addEventListener("dragleave", leave);
  window.addEventListener("drop", end);
  window.addEventListener("dragend", end);
  return () => {
    window.removeEventListener("dragover", over);
    window.removeEventListener("dragenter", enter);
    window.removeEventListener("dragleave", leave);
    window.removeEventListener("drop", end);
    window.removeEventListener("dragend", end);
  };
}

export function dropTargetAt(x: number, y: number, skip: (element: Element) => boolean): HTMLElement | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (skip(element)) continue;
    const target = element.closest<HTMLElement>("[data-drop]");
    if (target && !skip(target)) return target;
  }
  return null;
}

let marked: HTMLElement | null = null;

export function markDropTarget(target: HTMLElement | null) {
  if (marked === target) return;
  marked?.removeAttribute("data-over");
  target?.setAttribute("data-over", "");
  marked = target;
}

export function acknowledge(target: HTMLElement) {
  if (reduceMotion()) return;
  target.animate([{ scale: "1" }, { scale: "1.045", offset: 0.3 }, { scale: "1" }], {
    duration: 460,
    easing: "cubic-bezier(0.34, 1.32, 0.64, 1)",
  });
}
