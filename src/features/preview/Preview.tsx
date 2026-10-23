import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { srcOf } from "../../lib/images";
import { openExternal } from "../../lib/api";
import { closest } from "../../lib/platform";
import type { Reference } from "../../types";
import { creditOf } from "../../components/Credit";

interface Props {
  refs: Reference[];
  index: number;
  onIndex(index: number): void;
  onClose(): void;
  onRemove?(reference: Reference): void;
  approval?: { approved: Set<string>; onToggle(reference: Reference): void };
}

const OPEN_GRACE_MS = 350;
const SWAP_PX = 28;

function Large({ reference, direction }: { reference: Reference; direction: number }) {
  const [loaded, setLoaded] = useState(false);
  const thumb = srcOf(reference.thumbUrl);
  const large = srcOf(reference.imageUrl);
  const image = "absolute inset-0 size-full object-contain";
  const ratio = reference.width / reference.height || 1;
  return (
    <div
      data-image
      className={`relative ${direction ? "animate-swap" : "animate-appear"}`}
      style={{
        width: `min(100cqw, calc(100cqh * ${ratio}))`,
        aspectRatio: `${reference.width || 1} / ${reference.height || 1}`,
        "--swap-x": `${direction * SWAP_PX}px`,
      }}
    >
      <img
        src={thumb}
        alt={reference.alt ?? reference.title ?? ""}
        referrerPolicy="no-referrer"
        draggable={false}
        className={image}
      />
      {large && reference.imageUrl !== reference.thumbUrl && (
        <img
          src={large}
          alt=""
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={`${image} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

export function Preview({ refs, index, onIndex, onClose, onRemove, approval }: Props) {
  const reference = refs[index];
  const count = refs.length;
  const opened = useRef(performance.now());
  const approved = approval?.approved.has(reference?.id ?? "") ?? false;
  const seen = useRef({ index, direction: 0 });
  if (seen.current.index !== index) {
    const step = index - seen.current.index;
    seen.current = { index, direction: Math.abs(step) > 1 ? -Math.sign(step) : Math.sign(step) };
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape" || event.key === " ") {
        event.preventDefault();
        onClose();
      }
      if (event.key === "ArrowLeft") onIndex((index - 1 + count) % count);
      if (event.key === "ArrowRight") onIndex((index + 1) % count);
      if (event.key === "Enter" && approval && reference) {
        event.preventDefault();
        approval.onToggle(reference);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, count, onClose, onIndex, approval, reference]);

  if (!reference) return null;
  const origin = reference.source === "local" ? "arquivo local" : reference.source === "url" ? "URL" : "web";

  const arrow = (direction: "left" | "right") => (
    <button
      type="button"
      aria-label={direction === "left" ? "Previous" : "Next"}
      onClick={() => onIndex(direction === "left" ? (index - 1 + count) % count : (index + 1) % count)}
      className="grid size-10 shrink-0 place-items-center rounded-full text-white/70 transition-[color,background-color,scale] duration-150 hover:bg-white/10 hover:text-white active:scale-90"
    >
      <Icon name={direction} size={20} />
    </button>
  );

  return (
    <div
      role="dialog"
      aria-label="Reference"
      onClick={(event) => {
        if (closest(event.target, "button, [data-image]") || performance.now() - opened.current < OPEN_GRACE_MS) return;
        onClose();
      }}
      className="fixed inset-0 z-40 flex animate-fade-in flex-col bg-black/90 text-white"
    >
      <div className="flex min-h-0 flex-1 items-center gap-4 px-4 pt-12">
        {count > 1 ? arrow("left") : <span className="size-10" />}
        <div className="grid h-full min-w-0 flex-1 place-items-center" style={{ containerType: "size" }}>
          <Large key={reference.id} reference={reference} direction={seen.current.direction} />
        </div>
        {count > 1 ? arrow("right") : <span className="size-10" />}
      </div>

      <footer className="flex items-center gap-4 px-8 py-5">
        {reference.palette?.length ? (
          <div className="flex shrink-0 items-center gap-1.5" aria-label="Dominant colors">
            {reference.palette.map((color) => (
              <Swatch key={color} color={color} />
            ))}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate">{reference.title ?? reference.alt ?? "Untitled"}</span>
          <span className="truncate text-xs text-white/60">
            {[
              creditOf(reference),
              origin,
              `${reference.width}×${reference.height}`,
              count > 1 && `${index + 1} of ${count}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {reference.sourceUrl && (
          <button
            type="button"
            onClick={() => openExternal(reference.sourceUrl)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 hover:bg-white/10"
          >
            <Icon name="external" size={14} /> Open original page
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(reference)}
            className="rounded-lg px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white"
          >
            Delete
          </button>
        )}
        {approval && (
          <button
            type="button"
            title="Enter"
            onClick={() => approval.onToggle(reference)}
            className={`flex items-center gap-1.5 rounded-full py-1.5 pr-4 pl-3 transition-colors ${
              approved ? "bg-white text-black" : "border border-white/30 hover:bg-white/10"
            }`}
          >
            <Icon name="check" size={14} />
            {approved ? "Approved" : "Approve"}
          </button>
        )}
      </footer>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 grid size-9 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white"
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? "Copied" : `${color.toUpperCase()} · click to copy`}
      aria-label={`Color ${color}`}
      onClick={() => void navigator.clipboard?.writeText(color).then(() => setCopied(true))}
      onMouseLeave={() => setCopied(false)}
      className="size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)] transition-[scale] duration-150 hover:scale-115"
      style={{ background: color }}
    />
  );
}
