import { type MouseEvent, useState } from "react";
import { flushSync } from "react-dom";
import { reduceMotion } from "../../lib/platform";

const REVEAL_MS = 560;

export function ThemeToggle() {
  const root = document.documentElement;
  const [theme, setTheme] = useState(root.dataset.theme);

  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    const next = theme === "dark" ? "light" : "dark";
    const apply = () => {
      root.dataset.theme = next;
      localStorage.setItem("ganymede:theme", next);
      flushSync(() => setTheme(next));
    };
    if (!document.startViewTransition || reduceMotion()) return apply();
    const box = event.currentTarget.getBoundingClientRect();
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.dataset.themeFlip = "";
    const transition = document.startViewTransition(apply);
    void transition.ready
      .then(() =>
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          {
            duration: REVEAL_MS,
            easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        ),
      )
      .catch(() => {});
    void transition.finished.finally(() => delete root.dataset.themeFlip);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Use light theme" : "Use dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
      className="grid size-7 place-items-center rounded-md text-muted transition-[color,background-color,scale] duration-150 hover:bg-skeleton hover:text-fg active:scale-90"
    >
      <svg viewBox="0 0 24 24" width={15} height={15} aria-hidden>
        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path
          d="M12 4a8 8 0 010 16z"
          fill="currentColor"
          className="origin-center transition-[rotate] duration-500 ease-spring"
          style={{ rotate: theme === "dark" ? "180deg" : "0deg" }}
        />
      </svg>
    </button>
  );
}
