import { useEffect, useRef, type ReactNode } from "react";

export type ConfirmAction = { label: string; tone?: "primary" | "danger"; onClick: () => void };

/** A modal choice. Escape or the close button runs onCancel; nothing happens by default. */
export function ConfirmDialog({ title, children, actions, onCancel, cancelLabel = "Cancel", busy }: { title: string; children: ReactNode; actions: ConfirmAction[]; onCancel: () => void; cancelLabel?: string; busy?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!, trigger = document.activeElement;
    node.showModal(); node.querySelector<HTMLButtonElement>("[data-safe]")?.focus();
    return () => { node.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={dialog} className="ticket-dialog confirm-dialog" aria-labelledby="confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <div className="dialog-heading"><h2 id="confirm-title">{title}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onCancel} disabled={busy}>×</button></div>
    <div className="confirm-body">{children}</div>
    <div className="dialog-actions">
      <button type="button" data-safe onClick={onCancel} disabled={busy}>{cancelLabel}</button>
      {actions.map(action => <button type="button" key={action.label} className={action.tone ?? ""} onClick={action.onClick} disabled={busy}>{action.label}</button>)}
    </div>
  </dialog>;
}
