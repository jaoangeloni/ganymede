import { useState } from "react";
import { Icon } from "../../components/Icon";
import { toggle } from "../../lib/library";
import type { Collection, Reference } from "../../types";
import { NameInput } from "./NameInput";
import { RefGrid, refMenu } from "./RefGrid";

interface Props {
  collection: Collection;
  refs: Reference[];
  selection: string[];
  onSelect(ids: string[]): void;
  onPreview(refIds: string[], refId: string): void;
  onRename(name: string): void;
  onDeleteRefs(refIds: string[], done: () => void): void;
  arriving: string[] | null;
  within?: { space: string; onSpace(): void };
}

export function LibraryView({
  collection,
  refs,
  selection,
  onSelect,
  onPreview,
  onRename,
  onDeleteRefs,
  arriving,
  within,
}: Props) {
  const [picking, setPicking] = useState(false);
  const selected = new Set(selection);
  const active = picking || selection.length > 0;
  const stop = () => {
    setPicking(false);
    onSelect([]);
  };

  return (
    <div
      data-drop={`collection:${collection.id}`}
      className="absolute inset-0 no-scrollbar overflow-y-auto px-10 pt-7 pb-40"
    >
      <header className="mb-6 flex h-9 items-center gap-2">
        {within && (
          <nav aria-label="Path" className="flex shrink-0 items-center gap-1 text-[22px] tracking-tight text-muted">
            <button
              type="button"
              onClick={within.onSpace}
              title="Back to the space"
              className="-ml-1.5 max-w-60 truncate rounded-md px-1.5 transition-colors hover:bg-skeleton hover:text-fg"
            >
              {within.space}
            </button>
            <Icon name="right" size={18} />
          </nav>
        )}
        <NameInput
          collection={collection}
          onRename={onRename}
          className={`${within ? "" : "-ml-1.5"} px-1.5 text-[22px] font-medium tracking-tight`}
        />
        <span className="text-muted tabular-nums">{refs.length}</span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {active ? (
            <PickActions count={selection.length} onCancel={stop} onDelete={() => onDeleteRefs(selection, stop)} />
          ) : (
            refs.length > 0 && <PickButton onClick={() => setPicking(true)} />
          )}
          {within && (
            <button
              type="button"
              onClick={within.onSpace}
              aria-label={`Back to ${within.space}`}
              title="Back to the map (Esc)"
              className="ml-1 grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-skeleton hover:text-fg"
            >
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </header>

      {refs.length ? (
        <RefGrid
          refs={refs}
          selected={selected}
          onClick={(reference, event) => {
            if (active || event.shiftKey || event.ctrlKey || event.metaKey) {
              onSelect(toggle(selection, reference.id));
            } else {
              onPreview(
                refs.map((ref) => ref.id),
                reference.id,
              );
            }
          }}
          dragIds={(reference) => (selected.has(reference.id) ? selection : [reference.id])}
          arriving={arriving}
          menuOf={(reference) =>
            refMenu(
              reference,
              () =>
                onPreview(
                  refs.map((ref) => ref.id),
                  reference.id,
                ),
              () => onDeleteRefs([reference.id], () => onSelect(selection.filter((id) => id !== reference.id))),
            )
          }
        />
      ) : (
        <div className="grid h-[50vh] place-content-center gap-1 text-center">
          <p className="text-base">Empty collection</p>
          <p className="text-muted">Search in the bar below, drag images here or paste an image URL.</p>
        </div>
      )}
    </div>
  );
}

interface PickProps {
  count: number;
  onDelete(): void;
  onCancel(): void;
}

function PickActions({ count, onDelete, onCancel }: PickProps) {
  return (
    <>
      <span className="mr-auto truncate text-muted tabular-nums">
        {count ? `${count} selected` : "Click the ones to delete"}
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="h-8 shrink-0 rounded-lg px-3 transition-colors hover:bg-skeleton"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={!count}
        onClick={onDelete}
        className="h-8 shrink-0 rounded-lg bg-fg px-3 text-bg transition-opacity hover:opacity-85 disabled:opacity-30"
      >
        Delete
      </button>
    </>
  );
}

function PickButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-8 shrink-0 rounded-lg px-3 text-muted transition-colors hover:bg-skeleton hover:text-fg"
    >
      Select
    </button>
  );
}
