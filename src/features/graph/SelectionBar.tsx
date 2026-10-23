import { Icon } from "../../components/Icon";

interface Props {
  count: number;
  onRemove(): void;
  onClear(): void;
}

export function SelectionBar({ count, onRemove, onClear }: Props) {
  const button =
    "flex h-8 items-center gap-1.5 rounded-lg px-3 transition-[background-color,color,scale] duration-150 hover:bg-skeleton hover:text-danger active:scale-95";

  return (
    <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 animate-drop-in items-center gap-1 rounded-xl border border-line bg-surface p-1 pl-3 whitespace-nowrap shadow-float">
      <span className="mr-1 text-muted tabular-nums">
        <span key={count} className="inline-block animate-bump text-fg">
          {count}
        </span>{" "}
        selected
      </span>
      <button type="button" onClick={onRemove} className={button}>
        Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        className="grid size-8 place-items-center rounded-lg text-muted transition-[background-color,color,scale] duration-150 hover:bg-skeleton hover:text-fg active:scale-90"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
