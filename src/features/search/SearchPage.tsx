import { type FormEvent, useEffect, useRef, useState } from "react";
import { useAutoGrow } from "./useAutoGrow";
import { Icon } from "../../components/Icon";
import { Menu, MenuItem } from "../../components/Menu";
import { collectionTint, ink } from "../../lib/color";
import { displayName } from "../../lib/library";
import type { Filters } from "./pipeline/bing";
import type { Collection, Library } from "../../types";
import { DotField } from "./DotField";
import { SearchFilters } from "./SearchFilters";

interface Props {
  library: Library;
  initial: string | null;
  filters: Filters;
  onFilters(filters: Filters): void;
  onStart(prompt: string, collectionId: string | null): void;
}

export function SearchPage({ library, initial, filters, onFilters, onStart }: Props) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<string | null>(initial);
  const chosen = library.collections.find((collection) => collection.id === target);
  const groups = [
    ...library.spaces.map((space) => ({
      name: space.name,
      collections: library.collections.filter((collection) => collection.spaceId === space.id),
    })),
    { name: "Standalone", collections: library.collections.filter((collection) => !collection.spaceId) },
  ].filter((group) => group.collections.length);
  useAutoGrow(input, text, 4 * 26 + 24);
  useEffect(() => input.current?.focus(), []);

  const typed = text.trim().length > 0;
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (typed) onStart(text.trim(), chosen?.id ?? null);
  };
  const dot = (collection: Collection) => (
    <span
      className="size-2.5 shrink-0 rounded-full"
      style={{
        background: ink(
          collectionTint(
            collection.id,
            collection.refIds.map((id) => library.refs[id]),
          ),
        ),
      }}
    />
  );

  return (
    <div className="absolute inset-0 grid animate-fade-in place-items-center bg-bg px-8 pb-[6vh]">
      <DotField />
      <form onSubmit={submit} className="relative w-[min(680px,100%)]">
        <div
          data-prompt
          className="rounded-2xl border border-line bg-surface shadow-float transition-[border-color,box-shadow] duration-200 focus-within:border-fg/25"
        >
          <textarea
            ref={input}
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
            placeholder={"Frutiger aero aesthetic..."}
            aria-label="Search prompt"
            spellCheck={false}
            autoComplete="off"
            className="block min-h-[72px] w-full resize-none no-scrollbar bg-transparent px-5 pt-4 pb-1 text-[17px] leading-[26px] outline-none select-text placeholder:text-muted/70"
          />
          <div className="flex h-12 items-center gap-1 pr-2 pl-2.5 text-[13px] text-muted">
            <Menu
              label="Collection for this search"
              text={
                <span className="flex min-w-0 items-center gap-2">
                  {chosen ? dot(chosen) : <Icon name="plus" size={13} />}
                  <span className="max-w-60 truncate">{chosen ? displayName(chosen) : "New collection"}</span>
                  <Icon name="down" size={12} />
                </span>
              }
              className="hover:bg-skeleton hover:text-fg"
            >
              <MenuItem icon="plus" onClick={() => setTarget(null)}>
                <span className="mr-auto">New collection</span>
                {!chosen && <Icon name="check" size={14} />}
              </MenuItem>
              <div className="max-h-72 no-scrollbar overflow-y-auto">
                {groups.map((group) => (
                  <div key={group.name}>
                    <p className="px-2.5 pt-3 pb-1 text-xs text-muted">{group.name}</p>
                    {group.collections.map((collection) => (
                      <MenuItem key={collection.id} onClick={() => setTarget(collection.id)}>
                        {dot(collection)}
                        <span className="mr-auto max-w-56 truncate">{displayName(collection)}</span>
                        {collection.id === target ? (
                          <Icon name="check" size={14} />
                        ) : (
                          <span className="text-xs text-muted tabular-nums">{collection.refIds.length}</span>
                        )}
                      </MenuItem>
                    ))}
                  </div>
                ))}
              </div>
            </Menu>
            <span className="ml-auto" />
            <SearchFilters filters={filters} onChange={onFilters} />
            <kbd
              className={`mx-1.5 font-sans text-xs transition-[opacity,translate] duration-300 ease-swift ${typed ? "opacity-100" : "translate-x-1 opacity-0"}`}
            >
              Enter
            </kbd>
            <button
              type="submit"
              aria-label="Search"
              disabled={!typed}
              className={`grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,color,scale] duration-300 ease-spring active:scale-90 ${
                typed ? "scale-100 bg-primary text-on-primary" : "scale-90 bg-skeleton text-muted"
              }`}
            >
              <Icon name="search" size={16} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
