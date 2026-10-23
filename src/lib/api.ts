import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

export { isTauri };

export type Row = [kind: string, scope: string, id: string, data: string];
export type Key = [kind: string, scope: string, id: string];
export type Edge = [a: number, b: number, similarity: number];

export interface Signature {
  hash: string;
  embedding?: number[] | null;
  pixels?: number[];
}

export const loadRows = () => invoke<Row[]>("store_load");

export const writeRows = (upsert: Row[], remove: Key[]) => invoke<void>("store_write", { upsert, remove });

export const saveOriginal = (id: string, bytes: ArrayBuffer) =>
  invoke<void>("store_original", new Uint8Array(bytes), { headers: { "x-id": id } });

export const mediaUrl = (kind: "thumb" | "preview" | "original", id: string) =>
  isTauri() ? convertFileSrc(`${kind}/${id}`, "media") : "";

export const analyzeImages = (urls: string[], embed: boolean) =>
  invoke<(Signature | null)[]>("analyze_images", { urls, embed });

export const visionRate = () => invoke<number | null>("vision_rate");

export const graphEdges = (space: string, ids: string[]) => invoke<Edge[]>("graph_edges", { space, ids });

export async function fetchBing(url: string): Promise<string> {
  if (isTauri()) return invoke<string>("fetch_bing", { url });
  const browser = typeof window !== "undefined";
  const response = await fetch(
    browser ? url.replace("https://www.bing.com", "/bing") : url,
    browser ? {} : { headers: { "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Ganymede/0.1 (local script)" } },
  );
  if (!response.ok) throw new Error(`www.bing.com answered ${response.status}`);
  return response.text();
}

export function warmBing(): void {
  if (isTauri()) void invoke("warm_web").catch(() => {});
}

export function onMediaReady(handle: (ids: string[]) => void): () => void {
  if (!isTauri()) return () => {};
  const stop = listen<string[]>("media-ready", (event) => handle(event.payload));
  return () => void stop.then((unlisten) => unlisten());
}

export function openExternal(url: string): void {
  if (isTauri()) void openUrl(url);
  else window.open(url, "_blank", "noopener");
}

const opened = new Map<string, WebviewWindow>();

export function openWindow(label: string, url: string, title: string, onClosed: () => void): void {
  const created = new WebviewWindow(label, {
    url,
    title,
    width: 960,
    height: 720,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: "#111111",
  });
  opened.set(label, created);
  const closed = () => {
    opened.delete(label);
    onClosed();
  };
  void created.once("tauri://destroyed", closed);
  void created.once("tauri://error", closed);
}

export function closeWindow(label: string): void {
  void opened.get(label)?.close();
  opened.delete(label);
}

export function focusWindow(label?: string): void {
  void (label ? opened.get(label) : getCurrentWindow())?.setFocus();
}
