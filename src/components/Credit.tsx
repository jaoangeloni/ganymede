import { Icon } from "./Icon";
import { openExternal } from "../lib/api";
import { siteOf } from "../lib/library";
import type { Reference } from "../types";

export const creditOf = (reference: Reference) =>
  reference.source === "local" ? "arquivo local" : [reference.author, siteOf(reference)].filter(Boolean).join(" · ");

export function Credit({ reference }: { reference: Reference }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/65 to-transparent p-2 pt-10 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
      <span className="flex min-w-0 flex-col text-xs leading-snug">
        {reference.title && <span className="truncate text-white">{reference.title}</span>}
        <span className="truncate text-white/75">{creditOf(reference)}</span>
      </span>
      {reference.sourceUrl && (
        <button
          type="button"
          aria-label="Open original page"
          title="Open original page"
          onClick={() => openExternal(reference.sourceUrl)}
          className="pointer-events-auto grid size-6 shrink-0 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/75"
        >
          <Icon name="external" size={13} />
        </button>
      )}
    </div>
  );
}
