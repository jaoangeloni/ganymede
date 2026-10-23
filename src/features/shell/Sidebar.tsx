import { type Dispatch, type MouseEvent, useEffect, useState } from "react";
import { ContextMenu, type MenuEntry } from "../../components/ContextMenu";
import { Icon } from "../../components/Icon";
import { Mark } from "./Mark";
import { Menu, MenuItem } from "../../components/Menu";
import { Picture } from "../../components/Picture";
import { ThemeToggle } from "./ThemeToggle";
import { collectionTint, ink } from "../../lib/color";
import { startDrag } from "../../lib/drag";
import { displayName, newId, UNNAMED } from "../../lib/library";
import { MOD } from "../../lib/platform";
import type { Action } from "../../state";
import type { Library, Reference, Space, View } from "../../types";

type Kind = "space" | "collection";

const SEARCH_KEYS = `${MOD}K`;

interface Props {
  library: Library;
  view: View;
  dispatch: Dispatch<Action>;
  onNavigate(view: View): void;
  onDelete(kind: Kind, id: string): void;
  onAddToSpace(collectionId: string): void;
  onCopyOut(collectionId: string): void;
  onSearch(): void;
  onNewCollection(spaceId: string): void;
  onPick(collectionId: string): void;
  onHover(collectionId: string | null): void;
  picked: string | null;
  collapsed: boolean;
  onCollapse(): void;
}

function NameField({ name, onDone }: { name: string; onDone(name: string | null): void }) {
  return (
    <input
      autoFocus
      defaultValue={name}
      aria-label="Name"
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => onDone(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") onDone(null);
      }}
      className="min-w-0 flex-1 bg-transparent text-fg outline-none select-text"
    />
  );
}

function RowMenu({ entries }: { entries: MenuEntry[] }) {
  return (
    <Menu label="Actions" className="hidden group-hover:grid">
      {entries.map(
        (entry) =>
          entry !== "separator" && (
            <MenuItem key={entry.label} icon={entry.icon} onClick={entry.onSelect}>
              {entry.label}
            </MenuItem>
          ),
      )}
    </Menu>
  );
}

export function Sidebar(props: Props) {
  return props.collapsed ? <Rail {...props} /> : <Full {...props} />;
}

function Wordmark({ onSearch, compact = false }: { onSearch(): void; compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={onSearch}
      title={`Search (${SEARCH_KEYS})`}
      className="group/mark flex items-center gap-2 rounded-md text-fg"
    >
      <span className="grid transition-[rotate,scale] duration-500 ease-spring group-hover/mark:-rotate-[24deg] group-active/mark:scale-90">
        <Mark size={compact ? 22 : 20} />
      </span>
      {!compact && <span className="font-semibold tracking-[-0.01em]">Ganymede</span>}
    </button>
  );
}

const railButton =
  "grid size-8 place-items-center rounded-lg text-muted transition-[color,background-color,scale] duration-150 hover:bg-skeleton hover:text-fg active:scale-90";

function Rail({ view, onSearch, onCollapse }: Props) {
  return (
    <nav
      aria-label="Navigation"
      className="flex w-12 shrink-0 animate-fade-in flex-col items-center gap-1 rounded-xl border border-line bg-surface py-2.5"
    >
      <div className="mb-2 grid h-8 place-items-center">
        <Wordmark onSearch={onSearch} compact />
      </div>
      <button
        type="button"
        data-stay
        onClick={onCollapse}
        aria-label="Open the sidebar"
        title={`Open the sidebar (${MOD}B)`}
        className={railButton}
      >
        <Icon name="sidebar" size={15} />
      </button>
      <button
        type="button"
        onClick={onSearch}
        aria-current={view.kind === "home" ? "page" : undefined}
        title={`Search (${SEARCH_KEYS})`}
        className={`${railButton} ${view.kind === "home" ? "bg-skeleton text-fg" : ""}`}
      >
        <Icon name="search" size={15} />
      </button>
      <div data-stay className="mt-auto">
        <ThemeToggle />
      </div>
    </nav>
  );
}

function Full({
  library,
  view,
  dispatch,
  onNavigate,
  onDelete,
  onAddToSpace,
  onCopyOut,
  onSearch,
  onNewCollection,
  onPick,
  onHover,
  picked,
  onCollapse,
}: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const opened = "id" in view ? view.id : null;
  const spaceId =
    view.kind === "space"
      ? view.id
      : (library.collections.find((collection) => collection.id === opened)?.spaceId ?? null);
  const collections = library.collections.filter((collection) => !collection.spaceId);
  const [open, setOpen] = useState<Set<string>>(() => new Set(spaceId ? [spaceId] : []));
  useEffect(() => {
    if (spaceId) setOpen((current) => (current.has(spaceId) ? current : new Set([...current, spaceId])));
  }, [spaceId]);
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const create = (kind: Kind) => {
    const id = newId();
    dispatch(
      kind === "space"
        ? { type: "space-created", id, name: "New space" }
        : { type: "collection-created", id, name: "New collection" },
    );
    onNavigate({ kind, id });
    setRenaming(id);
  };

  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const actionsOf = (kind: Kind, id: string): MenuEntry[] => {
    if (kind === "collection" && library.collections.find((collection) => collection.id === id)?.spaceId)
      return [
        { label: "Rename", icon: "pencil", onSelect: () => setRenaming(id) },
        { label: "Copy to a standalone collection", icon: "copy", onSelect: () => onCopyOut(id) },
        "separator",
        { label: "Delete collection", icon: "trash", onSelect: () => onDelete(kind, id) },
      ];
    return [
      ...(kind === "space"
        ? ([
            {
              label: "New collection",
              icon: "plus",
              hint: id === spaceId ? `${MOD}N` : undefined,
              onSelect: () => onNewCollection(id),
            },
            "separator",
          ] as const)
        : []),
      { label: "Rename", icon: "pencil", onSelect: () => setRenaming(id) },
      { label: "Duplicate", icon: "copy", onSelect: () => dispatch({ type: "duplicated", kind, id, newId: newId() }) },
      ...(kind === "collection" && spaceId
        ? [{ label: "Add to the open space", icon: "plus", onSelect: () => onAddToSpace(id) } as const]
        : []),
      ...(kind === "collection" || library.spaces.length > 1
        ? (["separator", { label: "Delete", icon: "trash", onSelect: () => onDelete(kind, id) }] as const)
        : []),
    ];
  };
  const openMenu = (event: MouseEvent, kind: Kind, id: string) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, entries: actionsOf(kind, id) });
  };

  const finishRename = (kind: Kind, id: string, name: string | null) => {
    setRenaming(null);
    if (name?.trim()) dispatch({ type: "renamed", kind, id, name: name.trim() });
  };

  const row = (kind: Kind, item: { id: string; name: string }, count?: number, cover?: Reference) => {
    const active = view.kind === kind && "id" in view && view.id === item.id;
    return (
      <li
        key={item.id}
        data-drop={`${kind}:${item.id}`}
        draggable={kind === "collection" && renaming !== item.id}
        onDragStart={(event) => startDrag(event, { collectionId: item.id })}
        onContextMenu={(event) => openMenu(event, kind, item.id)}
        className={`group flex h-8 items-center gap-1 rounded-lg pr-1 pl-2.5 transition-colors ${
          active ? "bg-skeleton text-fg" : "text-muted hover:bg-skeleton hover:text-fg"
        }`}
      >
        {kind === "space" && (
          <button
            type="button"
            onClick={() => toggle(item.id)}
            aria-label={open.has(item.id) ? "Collapse collections" : "Show collections"}
            aria-expanded={open.has(item.id)}
            className="-ml-1.5 grid size-5 shrink-0 place-items-center rounded text-muted hover:text-fg"
          >
            <span className={`grid transition-transform duration-150 ${open.has(item.id) ? "rotate-90" : ""}`}>
              <Icon name="right" size={12} />
            </span>
          </button>
        )}
        {kind === "space" && <Icon name="folder" size={15} />}
        {kind === "collection" && (
          <span className="relative mr-1 size-5 shrink-0 overflow-hidden rounded-[5px] bg-skeleton">
            {cover && <Picture key={cover.id} reference={cover} sharp={false} />}
          </span>
        )}
        {renaming === item.id ? (
          <NameField name={item.name} onDone={(name) => finishRename(kind, item.id, name)} />
        ) : (
          <button
            type="button"
            onClick={() => onNavigate({ kind, id: item.id })}
            onDoubleClick={() => setRenaming(item.id)}
            className="min-w-0 flex-1 truncate text-left"
          >
            {item.name || UNNAMED}
          </button>
        )}
        {count !== undefined && <span className="px-1 text-xs tabular-nums group-hover:hidden">{count}</span>}
        <RowMenu entries={actionsOf(kind, item.id)} />
      </li>
    );
  };

  const tree = (space: Space, shown: boolean, picked: string | null) => {
    const owned = library.collections.filter((collection) => collection.spaceId === space.id);
    return (
      <div
        inert={!shown}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-swift ${shown ? "grid-rows-[1fr]" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <ul
            aria-label={`Collections in ${space.name}`}
            className="flex flex-col gap-1 pt-1 pl-4"
            onPointerLeave={() => onHover(null)}
          >
            {owned.map((collection) => {
              const here = picked === collection.id;
              const dot = (
                <span
                  className={`size-2.5 shrink-0 rounded-full transition-[scale,outline-color] duration-300 ease-spring group-hover:scale-125 ${here ? "outline-[1.5px] outline-offset-2 outline-fg" : "outline-transparent"}`}
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
                <li
                  key={collection.id}
                  data-drop={`collection:${collection.id}`}
                  onPointerEnter={() => onHover(collection.id)}
                  onContextMenu={(event) => openMenu(event, "collection", collection.id)}
                  className={`group flex h-7 items-center gap-1 rounded-lg pr-1 pl-2 transition-colors duration-150 ${here ? "bg-skeleton text-fg" : "text-muted hover:bg-skeleton hover:text-fg"}`}
                >
                  {renaming === collection.id ? (
                    <>
                      <span className="mr-1.5 grid">{dot}</span>
                      <NameField
                        name={collection.name}
                        onDone={(name) => finishRename("collection", collection.id, name)}
                      />
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPick(collection.id)}
                      onDoubleClick={() => setRenaming(collection.id)}
                      className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      {dot}
                      <span className="min-w-0 flex-1 truncate">{displayName(collection)}</span>
                    </button>
                  )}
                  <span className="px-1 text-xs tabular-nums group-hover:hidden">{collection.refIds.length}</span>
                  <RowMenu entries={actionsOf("collection", collection.id)} />
                </li>
              );
            })}
            <li>
              <button
                type="button"
                onClick={() => onNewCollection(space.id)}
                title={`New collection in ${space.name}${space.id === spaceId ? ` (${MOD}N)` : ""}`}
                className="group flex h-7 w-full items-center gap-2.5 rounded-lg pr-1 pl-2 text-left text-muted transition-colors duration-150 hover:bg-skeleton hover:text-fg"
              >
                <span className="-mx-px grid size-3 shrink-0 place-items-center transition-transform duration-300 ease-spring group-hover:rotate-90">
                  <Icon name="plus" size={12} />
                </span>
                New collection
              </button>
            </li>
          </ul>
        </div>
      </div>
    );
  };

  const heading = (kind: Kind, label: string) => (
    <div className="mt-5 mb-0.5 flex h-7 items-center justify-between pr-1 pl-2.5 text-xs text-muted">
      {label}
      <button
        type="button"
        onClick={() => create(kind)}
        aria-label={kind === "space" ? "New space" : "New collection"}
        title={kind === "space" ? "New space" : "New collection"}
        className="grid size-6 place-items-center rounded-md transition-[color,background-color,rotate] duration-300 ease-spring hover:rotate-90 hover:bg-skeleton hover:text-fg"
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );

  return (
    <nav aria-label="Navigation" className="flex w-64 shrink-0 flex-col rounded-xl border border-line bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-0.5 pr-2 pl-4">
        <span className="mr-auto">
          <Wordmark onSearch={onSearch} />
        </span>
        <button
          type="button"
          data-stay
          onClick={onCollapse}
          aria-label="Collapse the sidebar"
          title={`Collapse the sidebar (${MOD}B)`}
          className={railButton}
        >
          <Icon name="sidebar" size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 no-scrollbar overflow-y-auto px-2.5 pb-4">
        <button
          type="button"
          onClick={onSearch}
          aria-current={view.kind === "home" ? "page" : undefined}
          aria-keyshortcuts="Control+K"
          title={`Search (${SEARCH_KEYS})`}
          className={`group mt-1 flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors ${
            view.kind === "home" ? "bg-skeleton text-fg" : "text-muted hover:bg-skeleton hover:text-fg"
          }`}
        >
          <Icon name="search" size={15} />
          <span className="flex-1">Search</span>
          <kbd className="font-sans text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100">
            {SEARCH_KEYS}
          </kbd>
        </button>
        {heading("space", "Spaces")}
        <ul className="flex flex-col gap-1">
          {library.spaces.map((space) => (
            <li key={space.id}>
              <ul>{row("space", space)}</ul>
              {tree(space, open.has(space.id), space.id === spaceId ? (picked ?? opened) : null)}
            </li>
          ))}
        </ul>
        {heading("collection", "Collections")}
        <ul className="flex flex-col gap-1">
          {collections.map((collection) =>
            row("collection", collection, collection.refIds.length, library.refs[collection.refIds.at(-1) ?? ""]),
          )}
        </ul>
      </div>
      <div data-stay className="flex h-12 shrink-0 items-center justify-end border-t border-line pr-2 pl-2.5">
        <ThemeToggle />
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </nav>
  );
}
