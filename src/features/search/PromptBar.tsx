import { type RefObject, useEffect } from "react";
import { useAutoGrow } from "./useAutoGrow";
import { Icon } from "../../components/Icon";
import { MOD } from "../../lib/platform";
import type { Filters } from "./pipeline/bing";
import { SearchFilters } from "./SearchFilters";

const MAX_HEIGHT = 5 * 22 + 24;

interface Props {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange(value: string): void;
  filters: Filters;
  onFilters(filters: Filters): void;
  onSubmit(): void;
  onDismiss(): void;
  onImport?(): void;
  placeholder: string;
  focusKey?: string;
  className?: string;
}

export function PromptBar({
  inputRef,
  value,
  onChange,
  filters,
  onFilters,
  onSubmit,
  onDismiss,
  onImport,
  placeholder,
  focusKey,
  className = "bottom-7 w-[min(720px,calc(100%-8rem))]",
}: Props) {
  useEffect(() => {
    if (focusKey === undefined) return;
    const timer = setTimeout(() => inputRef.current?.focus());
    return () => clearTimeout(timer);
  }, [inputRef, focusKey]);
  useAutoGrow(inputRef, value, MAX_HEIGHT);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      data-prompt
      className={`absolute left-1/2 z-30 flex -translate-x-1/2 animate-rise-in items-end gap-2 rounded-2xl border border-line bg-surface pr-3 pl-5 shadow-float transition-[border-color] duration-200 focus-within:border-fg/25 ${className}`}
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") return onDismiss();
          if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder={placeholder}
        aria-label="Search prompt"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 resize-none no-scrollbar bg-transparent py-3 text-[15px] leading-5.5 outline-none select-text placeholder:truncate placeholder:text-muted placeholder-shown:mask-[linear-gradient(to_right,#000_calc(100%-3rem),transparent)]"
      />
      <div className="mb-[11px] flex items-center gap-0.5">
        {onImport && (
          <button
            type="button"
            onClick={onImport}
            aria-label="Images from your computer"
            title={`Images from your computer (${MOD}O)`}
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-[color,background-color,scale] duration-150 hover:bg-skeleton hover:text-fg active:scale-95"
          >
            <Icon name="image" size={14} />
          </button>
        )}
        <SearchFilters filters={filters} onChange={onFilters} />
      </div>
    </form>
  );
}
