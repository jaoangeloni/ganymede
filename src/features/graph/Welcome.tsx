import { Icon } from "../../components/Icon";

export function Welcome({ onSearch }: { onSearch(): void }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid animate-fade-in place-content-center justify-items-center gap-3 px-24 text-center text-balance text-muted">
      <p>Empty space: search for references or drag images here.</p>
      <button
        type="button"
        onClick={onSearch}
        className="pointer-events-auto flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-on-primary transition-[filter,scale] duration-150 hover:brightness-105 active:scale-95"
      >
        <Icon name="search" size={15} />
        Search references
      </button>
    </div>
  );
}
