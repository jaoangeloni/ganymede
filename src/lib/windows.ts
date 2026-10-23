import type { Filters } from "../features/search/pipeline/bing";
import type { Action, AppState, Pane } from "../state";
import { isTauri } from "./api";
import { newId } from "./library";

export type Message =
  | { kind: "hello"; pane: Pane }
  | { kind: "state"; pane: Pane; state: AppState; selection: string[] }
  | { kind: "action"; action: Action }
  | { kind: "selection"; selection: string[] }
  | { kind: "carry"; refIds: string[] | null }
  | { kind: "dock"; pane: Pane }
  | { kind: "search"; collectionId?: string; prompt?: string; filters?: Filters }
  | { kind: "focus"; window: string; focused: boolean };

const isPane = (value: string | null): value is Pane => value === "board" || value === "map" || value === "catalog";

const params = new URLSearchParams(location.search);
const pane = params.get("pane");
export const solo: Pane | null = isPane(pane) ? pane : null;
const group = params.get("group") ?? newId();
const channel = new BroadcastChannel("ganymede");

export const windowLabel = (which: Pane) => `pane-${which}`;
export const windowUrl = (which: Pane) => `${location.pathname}?pane=${which}&group=${group}`;

type Handler = (message: Message) => void;
const handlers = new Set<Handler>();
let backlog: Message[] = [];
channel.addEventListener("message", (event: MessageEvent<{ group: string; message: Message }>) => {
  if (event.data.group !== group) return;
  if (event.data.message.kind === "focus") return heard(event.data.message.window, event.data.message.focused);
  if (!handlers.size) backlog.push(event.data.message);
  handlers.forEach((handle) => handle(event.data.message));
});

export const post = (message: Message) => channel.postMessage({ group, message });

// a detached window renders after it joins, and what arrives in between waits here
export function listen(handle: Handler): () => void {
  handlers.add(handle);
  const waiting = backlog;
  backlog = [];
  waiting.forEach(handle);
  return () => void handlers.delete(handle);
}

export function joinMain(which: Pane): Promise<{ state: AppState; selection: string[] }> {
  return new Promise((resolve) => {
    const stop = listen((message) => {
      if (message.kind !== "state" || message.pane !== which) return;
      stop();
      resolve({ state: message.state, selection: message.selection });
    });
    post({ kind: "hello", pane: which });
  });
}

// the app is away only when none of its windows has focus; WebKitGTK also blurs a window while a drag it started lasts
const me = solo ?? "main";
let holder = document.hasFocus() || !isTauri() ? me : null;
let dragging = false;
const watchers = new Set<(focused: boolean) => void>();

function heard(window: string, focused: boolean) {
  const next = focused ? window : holder === window ? null : holder;
  if (next === holder) return;
  holder = next;
  watchers.forEach((watch) => watch(holder !== null));
}

function tell(focused: boolean) {
  heard(me, focused);
  post({ kind: "focus", window: me, focused });
}

addEventListener("focus", () => tell(true));
addEventListener("blur", () => !dragging && tell(false));
addEventListener("pagehide", () => tell(false));
addEventListener("dragstart", (event) => (dragging = !event.defaultPrevented));
addEventListener("dragend", () => (dragging = false));

export function watchFocus(watch: (focused: boolean) => void): () => void {
  watchers.add(watch);
  watch(holder !== null);
  return () => void watchers.delete(watch);
}
