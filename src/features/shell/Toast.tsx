import { useEffect, useEffectEvent, useState } from "react";

const TOAST_MS = 5000;
const OUT_MS = 180;

export interface ToastMessage {
  id: number;
  message: string;
  undo?: () => void;
}

export function Toast({ toast, raised, onDismiss }: { toast: ToastMessage; raised: boolean; onDismiss(): void }) {
  const [leaving, setLeaving] = useState(false);
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    const out = setTimeout(() => setLeaving(true), TOAST_MS - OUT_MS);
    const timer = setTimeout(() => dismiss(), TOAST_MS);
    return () => {
      clearTimeout(out);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div
      role="status"
      className={`absolute ${raised ? "bottom-28" : "bottom-6"} left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 overflow-hidden rounded-xl bg-fg py-1.5 pr-1.5 pl-4 whitespace-nowrap text-bg shadow-float ${leaving ? "animate-sink" : "animate-rise-in"}`}
    >
      <span className="py-1">{toast.message}</span>
      {toast.undo && (
        <>
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left animate-countdown bg-bg/25"
            style={{ animationDuration: `${TOAST_MS}ms` }}
          />
          <button
            type="button"
            onClick={() => {
              toast.undo?.();
              onDismiss();
            }}
            className="rounded-lg px-2.5 py-1 font-medium transition-[background-color,scale] duration-150 hover:bg-bg/15 active:scale-95"
          >
            Undo
          </button>
        </>
      )}
    </div>
  );
}
