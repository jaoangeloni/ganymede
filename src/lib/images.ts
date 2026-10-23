import type { Reference } from "../types";
import { newId } from "./library";
import { mediaUrl, saveOriginal } from "./api";

const VARIANTS = { thumb: "preview", small: "thumb" } as const;

export function srcOf(url: string): string {
  if (!url.startsWith("local:")) return url;
  const [, id, variant] = url.match(/^(local:[^:]+)(?::(thumb|small))?$/) ?? [];
  return id ? mediaUrl(variant ? VARIANTS[variant as keyof typeof VARIANTS] : "original", id) : url;
}

async function importFile(file: File): Promise<Reference> {
  const bitmap = await createImageBitmap(file);
  const id = `local:${newId()}`;
  await saveOriginal(id, await file.arrayBuffer());
  const ref: Reference = {
    id,
    source: "local",
    imageUrl: id,
    thumbUrl: `${id}:thumb`,
    sourceUrl: "",
    width: bitmap.width,
    height: bitmap.height,
    title: file.name.replace(/\.[^.]+$/, ""),
  };
  bitmap.close();
  return ref;
}

function importUrl(url: string): Promise<Reference> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.onload = () =>
      resolve({
        id: `url:${url}`,
        source: "url",
        imageUrl: url,
        thumbUrl: url,
        sourceUrl: url,
        width: image.naturalWidth,
        height: image.naturalHeight,
        title: decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "").replace(/\.[^.]+$/, "") || undefined,
      });
    image.onerror = () => reject(new Error("not an image"));
    image.src = url;
  });
}

export function readTransfer(data: DataTransfer) {
  const files = [...data.files].filter((file) => file.type.startsWith("image/"));
  const img = data
    .getData("text/html")
    .match(/<img[^>]+src="([^"]+)"/)?.[1]
    ?.replace(/&amp;/g, "&");
  const text = data.getData("text/uri-list") || data.getData("text/plain");
  const urls = (img ? [img] : text.split(/\s+/)).filter((url) => url.startsWith("https://"));
  return { files, urls: files.length ? [] : urls };
}

export async function importAll({ files, urls }: ReturnType<typeof readTransfer>): Promise<Reference[]> {
  const results = await Promise.allSettled([...files.map(importFile), ...urls.map(importUrl)]);
  return results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export function pickImages(): Promise<Reference[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () =>
      resolve(
        importAll({ files: [...(input.files ?? [])].filter((file) => file.type.startsWith("image/")), urls: [] }),
      );
    input.click();
  });
}
