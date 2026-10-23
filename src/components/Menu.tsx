import { type ReactNode, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon";

export function Menu({
  label,
  text,
  icon = "more",
  children,
  className = "",
}: {
  label: string;
  text?: ReactNode;
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left?: number; right?: number }>({
    left: 0,
  });

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        title={label}
        className={`shrink-0 transition-[color,background-color,scale] duration-150 active:scale-95 ${text ? "rounded-lg px-3 py-1.5" : "grid size-6 place-items-center rounded-md text-muted hover:bg-skeleton hover:text-fg"} ${className}`}
      >
        {text ?? <Icon name={icon} size={14} />}
      </button>
      <div
        id={id}
        popover="auto"
        onBeforeToggle={(event) => {
          if (event.newState !== "open" || !button.current) return;
          const rect = button.current.getBoundingClientRect();
          const x = rect.left > window.innerWidth / 2 ? { right: window.innerWidth - rect.right } : { left: rect.left };
          setPosition(
            rect.top > window.innerHeight / 2
              ? { bottom: window.innerHeight - rect.top + 4, ...x }
              : { top: rect.bottom + 4, ...x },
          );
        }}
        style={{
          top: "auto",
          right: "auto",
          bottom: "auto",
          left: "auto",
          ...position,
          "--menu-from": position.bottom === undefined ? "-4px" : "4px",
          transformOrigin: `${position.right === undefined ? "left" : "right"} ${position.bottom === undefined ? "top" : "bottom"}`,
        }}
        className="pointer-events-auto fixed m-0 min-w-44 rounded-xl border border-line bg-surface p-1 text-fg shadow-float open:animate-menu-in"
      >
        {children}
      </div>
    </>
  );
}

export function MenuItem({ icon, onClick, children }: { icon?: IconName; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
        onClick();
      }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left whitespace-nowrap transition-colors duration-100 hover:bg-skeleton"
    >
      {icon && (
        <span className="text-muted">
          <Icon name={icon} size={15} />
        </span>
      )}
      {children}
    </button>
  );
}
