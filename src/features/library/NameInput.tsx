import { displayName, UNNAMED } from "../../lib/library";
import type { Collection } from "../../types";

export function NameInput({
  collection,
  onRename,
  className,
}: {
  collection: Collection;
  onRename(name: string): void;
  className: string;
}) {
  return (
    <input
      key={collection.id}
      defaultValue={collection.name}
      placeholder={UNNAMED}
      size={Math.max(6, displayName(collection).length + 1)}
      aria-label="Collection name"
      onBlur={(event) => {
        const name = event.currentTarget.value.trim();
        if (name !== collection.name) onRename(name);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.currentTarget.value = collection.name;
          event.currentTarget.blur();
        }
      }}
      className={`field-sizing-content min-w-0 truncate rounded-md bg-transparent outline-none select-text placeholder:text-muted hover:bg-skeleton focus:bg-skeleton ${className}`}
    />
  );
}
