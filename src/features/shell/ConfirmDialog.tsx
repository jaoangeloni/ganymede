import { useEffect, useRef } from "react";

export interface Confirmation {
  title: string;
  body: string;
  action: string;
  onConfirm(): void;
}

export function ConfirmDialog({ title, body, action, onConfirm, onClose }: Confirmation & { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => event.target === event.currentTarget && dialog.current?.close()}
      className="m-auto w-[min(380px,calc(100%-2rem))] animate-rise-in rounded-2xl border border-line bg-surface p-0 text-fg shadow-float backdrop:animate-fade-in backdrop:bg-black/35"
    >
      <div className="p-5">
        <h2 className="text-base font-medium">{title}</h2>
        <p className="mt-1.5 text-muted">{body}</p>
        <form method="dialog" className="mt-6 flex justify-end gap-2">
          <button
            autoFocus
            className="h-9 rounded-lg px-3.5 transition-[background-color,scale] duration-150 hover:bg-skeleton active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              dialog.current?.close();
            }}
            className="h-9 rounded-lg bg-danger px-3.5 font-medium text-white transition-[filter,scale] duration-150 hover:brightness-110 active:scale-95"
          >
            {action}
          </button>
        </form>
      </div>
    </dialog>
  );
}
