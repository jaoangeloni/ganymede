import { Icon } from "../../components/Icon";
import { Menu, MenuItem } from "../../components/Menu";
import { ink } from "../../lib/color";
import { displayName } from "../../lib/library";
import type { Collection, Reference } from "../../types";
import { RefGrid, refMenu } from "./RefGrid";

interface SwitchProps {
  collection: Collection;
  others: Collection[];
  tintOf(collectionId: string): string;
  onSwitch(collectionId: string): void;
}

export function CollectionSwitch({ collection, others, tintOf, onSwitch }: SwitchProps) {
  const swatch = (id: string, size = "size-2") => (
    <span
      className={`${size} shrink-0 rounded-full transition-colors duration-500`}
      style={{ background: ink(tintOf(id)) }}
    />
  );
  const name = <span className="min-w-0 truncate">{displayName(collection)}</span>;
  if (others.length < 2)
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-fg">
        {swatch(collection.id)}
        {name}
      </span>
    );
  return (
    <Menu
      label="Switch collection"
      text={
        <>
          {swatch(collection.id)}
          {name}
          <Icon name="down" size={12} />
        </>
      }
      className="pointer-events-auto -ml-1 flex! h-6 min-w-0 shrink! items-center gap-1.5 rounded-md! px-1! py-0! text-fg hover:bg-skeleton"
    >
      {others.map((other) => (
        <MenuItem key={other.id} onClick={() => onSwitch(other.id)}>
          {swatch(other.id, "size-2.5")}
          <span className="mr-auto max-w-56 truncate">{displayName(other)}</span>
          {other.id === collection.id && <Icon name="check" size={14} />}
        </MenuItem>
      ))}
    </Menu>
  );
}

interface CollectionProps {
  collection: Collection;
  refs: Reference[];
  onPreview(refIds: string[], refId: string, collectionId: string): void;
  onDeleteRefs(refIds: string[], done: () => void): void;
}

export function CollectionCatalog({ collection, refs, onPreview, onDeleteRefs }: CollectionProps) {
  const open = (reference: Reference) =>
    onPreview(
      refs.map((ref) => ref.id),
      reference.id,
      collection.id,
    );

  return (
    <div
      data-drop={`collection:${collection.id}`}
      aria-label={`Collection ${displayName(collection)}`}
      className="absolute inset-0 animate-slide-in no-scrollbar overflow-y-auto px-3 pt-12 pb-24"
    >
      {refs.length ? (
        <RefGrid
          refs={refs}
          minColumn={160}
          onClick={open}
          dragIds={(reference) => [reference.id]}
          menuOf={(reference) =>
            refMenu(
              reference,
              () => open(reference),
              () => onDeleteRefs([reference.id], () => {}),
            )
          }
        />
      ) : (
        <p className="px-6 pt-16 text-center text-balance text-muted">
          Empty collection: describe below what to search for, or drag and import images here.
        </p>
      )}
    </div>
  );
}
