import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export type MenuEntry = { label: string; icon: IconName; hint?: string; onSelect(): void } | "separator";

interface Props {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose(): void;
}

export function ContextMenu({ x, y, entries, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ x, y });

  useLayoutEffect(() => {
    const element = menu.current!;
    element.showPopover();
    const { width, height } = element.getBoundingClientRect();
    setAt({
      x: x + width > innerWidth - 8 ? x - width : x,
      y: y + height > innerHeight - 8 ? Math.max(8, y - height) : y,
    });
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [x, y]);

  const close = useEffectEvent(onClose);
  useEffect(() => {
    const outside = (event: PointerEvent) =>
      !(event.target instanceof Node && menu.current?.contains(event.target)) && close();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
    };
    const blur = () => close();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
    };
  }, []);

  return (
    <div
      ref={menu}
      popover="manual"
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const items = [...menu.current!.querySelectorAll<HTMLButtonElement>("button")];
        const index = items.findIndex((item) => item === document.activeElement);
        items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }}
      style={{ top: at.y, left: at.x, right: "auto", bottom: "auto" }}
      className="fixed m-0 min-w-48 origin-top-left animate-menu-in rounded-xl border border-line bg-surface p-1 text-fg shadow-float"
    >
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <div key={i} className="mx-2 my-1 h-px bg-line" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left whitespace-nowrap transition-colors duration-100 outline-none hover:bg-skeleton focus-visible:bg-skeleton"
          >
            <span className="text-muted">
              <Icon name={entry.icon} size={15} />
            </span>
            <span className="mr-auto">{entry.label}</span>
            {entry.hint && <kbd className="pl-6 font-sans text-xs text-muted">{entry.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
