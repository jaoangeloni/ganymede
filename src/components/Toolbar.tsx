import { MOD } from "../lib/platform";
import { Icon, type IconName } from "./Icon";

type ToolDef<T extends string> = { id: T; icon: IconName; label: string; keys: string };
type ActionDef = { icon: IconName; label: string; keys?: string; pressed?: boolean; onClick(): void };

const SIZE = 32;
const GAP = 2;
const ZOOM_STEP = 1.25;

export function viewShortcut(key: string, onFit: () => void, onZoom: (factor?: number) => void): boolean {
  const keys: Record<string, () => void> = {
    e: onFit,
    "0": () => onZoom(),
    "=": () => onZoom(ZOOM_STEP),
    "+": () => onZoom(ZOOM_STEP),
    "-": () => onZoom(1 / ZOOM_STEP),
  };
  const run = keys[key];
  run?.();
  return run !== undefined;
}

interface Props<T extends string> {
  active: boolean;
  tools: ToolDef<T>[];
  tool: T;
  onTool(tool: T): void;
  actions: ActionDef[];
  zoom: { scale: number; range: [number, number]; onFit(): void; fitLabel: string; onActual(): void };
}

export function Toolbar<T extends string>({ active, tools, tool, onTool, actions, zoom }: Props<T>) {
  const index = tools.findIndex((item) => item.id === tool);
  const [min, max] = zoom.range;
  const button =
    "relative grid shrink-0 place-items-center rounded-lg transition-[color,background-color,scale] duration-150 active:scale-90";
  return (
    <div className="pointer-events-none absolute top-11 bottom-2 left-2.5 z-30 flex [align-items:safe_center]">
      <div
        role="toolbar"
        aria-label="Tools"
        aria-orientation="vertical"
        className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-float"
      >
        <div className="relative flex flex-col" style={{ gap: GAP }}>
          <span
            aria-hidden
            className="absolute top-0 left-0 rounded-lg bg-primary transition-[translate,opacity] duration-300 ease-swift"
            style={{
              width: SIZE,
              height: SIZE,
              translate: `0 ${index * (SIZE + GAP)}px`,
              opacity: active && index >= 0 ? 1 : 0,
            }}
          />
          {tools.map((item) => {
            const on = active && item.id === tool;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === tool}
                onClick={() => onTool(item.id)}
                title={`${item.label} (${item.keys})`}
                aria-label={item.label}
                className={`${button} ${on ? "text-on-primary" : "text-muted hover:bg-skeleton hover:text-fg"}`}
                style={{ width: SIZE, height: SIZE }}
              >
                <Icon name={item.icon} size={16} />
              </button>
            );
          })}
        </div>
        <span className="my-1 h-px w-5 bg-line" />
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            aria-pressed={action.pressed}
            onClick={action.onClick}
            title={action.keys ? `${action.label} (${action.keys})` : action.label}
            aria-label={action.label}
            className={`${button} ${action.pressed ? "bg-primary text-on-primary" : "text-muted hover:bg-skeleton hover:text-fg"}`}
            style={{ width: SIZE, height: SIZE }}
          >
            <Icon name={action.icon} size={16} />
          </button>
        ))}
        {actions.length > 0 && <span className="my-1 h-px w-5 bg-line" />}
        <button
          type="button"
          onClick={zoom.onFit}
          title={`${zoom.fitLabel} (${MOD}E)`}
          aria-label={zoom.fitLabel}
          className={`${button} text-muted hover:bg-skeleton hover:text-fg`}
          style={{ width: SIZE, height: SIZE }}
        >
          <Icon name="fit" size={16} />
        </button>
        <button
          type="button"
          onClick={zoom.onActual}
          title={`Actual size (${MOD}0)`}
          className={`${button} text-[11px] text-muted tabular-nums hover:bg-skeleton hover:text-fg`}
          style={{ width: SIZE, height: 26 }}
        >
          {Math.round(Math.min(1, Math.max(0, (zoom.scale - min) / (max - min))) * 100)}%
        </button>
      </div>
    </div>
  );
}
