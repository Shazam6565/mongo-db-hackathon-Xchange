import { useEffect, useRef, useState, type FormEvent } from "react";
import { TicketInputSchema, type TicketRecord } from "../../../../packages/contracts/src/tickets.js";
import { errorMessage, saveTicket } from "./api.js";

export function AddTicket({ storage, onClose, onSaved }: { storage: string; onClose: () => void; onSaved: (ticket: TicketRecord) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const requestId = useRef(crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const node = dialog.current!; node.showModal(); node.querySelector<HTMLInputElement>('input[name="summary"]')?.focus(); return () => node.close(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const input = TicketInputSchema.safeParse({
      summary: form.get("summary"), description: form.get("description"),
      ...(String(form.get("key") ?? "").trim() ? { key: form.get("key") } : {}),
      component: String(form.get("component") ?? "").trim() || null,
    });
    if (!input.success) { setError(input.error.issues[0]?.message ?? "Check the ticket fields."); return; }
    setSaving(true); setError("");
    try { onSaved(await saveTicket(input.data, requestId.current)); }
    catch (failure) { setError(errorMessage(failure)); setSaving(false); }
  }
  return <dialog className="ticket-dialog" ref={dialog} aria-labelledby="ticket-form-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <div className="dialog-heading"><h2 id="ticket-form-title">Add ticket</h2><button type="button" className="icon-button" aria-label="Close Add ticket" onClick={onClose} disabled={saving}>×</button></div>
      <fieldset disabled={saving}>
        <label>Summary <input name="summary" required maxLength={160} placeholder="A short, identifying title" autoFocus /></label>
        <div className="form-row">
          <label>Reference <span className="muted">optional</span><input name="key" maxLength={100} pattern="[A-Za-z0-9][A-Za-z0-9_.\-]*" placeholder="e.g. TEAM-123" /></label>
          <label>Component <span className="muted">optional</span><input name="component" maxLength={100} placeholder="e.g. notifications" /></label>
        </div>
        <label>Description <span className="muted">optional</span><textarea name="description" maxLength={8000} rows={7} placeholder="What is happening, and what should happen?" /></label>
      </fieldset>
      {error && <p role="alert" className="error-message">{error}</p>}
      <p className="muted form-note">{storage === "memory" ? "Saved in temporary storage. Tickets reset when the API restarts." : "Saved to this project. A reference is generated if left blank."}</p>
      <div className="dialog-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? "Adding…" : "Add ticket"}</button></div>
    </form>
  </dialog>;
}
