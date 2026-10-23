import { useEffect, useRef } from "react";
import { Icon } from "../../components/Icon";
import type { Reference } from "../../types";
import { creditOf } from "../../components/Credit";

const THUMB_WIDTH = 56;

interface Props {
  approved: Reference[];
  onRemove(reference: Reference): void;
  onOpen(reference: Reference): void;
}

export function ApprovedRail({ approved, onRemove, onOpen }: Props) {
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [approved.length]);

  if (!approved.length) return null;

  return (
    <aside
      aria-label="Approved references"
      className="fixed top-12 right-4 z-20 flex max-h-[calc(100vh-10.5rem)] animate-slide-in flex-col rounded-2xl border border-line bg-surface shadow-float"
    >
      <ul ref={list} className="flex no-scrollbar flex-col gap-1.5 overflow-y-auto p-2">
        {approved.map((reference) => (
          <li key={reference.id} className="group relative animate-rise-in">
            <button
              type="button"
              title={[reference.title, creditOf(reference)].filter(Boolean).join("\n")}
              onClick={() => onOpen(reference)}
              className="block overflow-hidden rounded-md bg-skeleton"
              style={{
                width: THUMB_WIDTH,
                height: Math.min(84, Math.max(36, (THUMB_WIDTH * reference.height) / reference.width)),
              }}
            >
              <img src={reference.thumbUrl} alt="" draggable={false} className="size-full object-cover" />
            </button>
            <button
              type="button"
              aria-label="Remove from approved"
              title="Remove"
              onClick={() => onRemove(reference)}
              className="absolute -top-1 -right-1 grid size-[18px] place-items-center rounded-full bg-fg text-bg opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
            >
              <Icon name="close" size={10} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
