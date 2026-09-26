import { useEffect, useRef, useState, type FormEvent } from "react";
import { ActivityInputSchema, ActivityRecordSchema, type ActivityInput, type ActivityRecord, type ActivitySubject } from "../../../../packages/contracts/src/activity.js";
import { errorMessage, request } from "../catalog/api.js";
import "./activity.css";

export function AddActivity({ onClose, onSaved, subject, defaultKind = "observation", runId }: {
  onClose: () => void; onSaved: (record: ActivityRecord) => void; subject?: ActivitySubject; defaultKind?: ActivityInput["kind"]; runId?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null), operation = useRef(crypto.randomUUID());
  const [kind, setKind] = useState(defaultKind), [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const node = dialog.current!, trigger = document.activeElement;
    node.showModal(); node.querySelector<HTMLInputElement>('input[name="title"]')?.focus();
    return () => { node.close(); if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(); };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const metrics = value("metric") || value("before") || value("after") || value("unit")
      ? [{ name: value("metric"), unit: value("unit"), before: value("before") ? Number(value("before")) : NaN, after: value("after") ? Number(value("after")) : NaN }] : [];
    const parsed = ActivityInputSchema.safeParse({ kind, title: value("title"), detail: value("detail"),
      ...(subject ? { subject } : {}), ...(runId || value("runId") ? { runId: runId || value("runId") } : {}),
      evidence: [{ reference: value("reference"), summary: value("evidence") }],
      ...(kind === "outcome" ? { outcome: { assessment: value("assessment"), comparison: value("comparison"), metrics } } : {}),
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the record fields."); return; }
    setSaving(true); setError("");
    try {
      const record = ActivityRecordSchema.parse(await request("/v1/activity", { method: "POST", headers: {
        "content-type": "application/json", "idempotency-key": operation.current, "x-engineer-id": value("actor") || "local-ui",
      }, body: JSON.stringify(parsed.data) }));
      onSaved(record);
    } catch (failure) { setError(errorMessage(failure)); setSaving(false); }
  }
  return <dialog ref={dialog} className="ticket-dialog activity-dialog" aria-labelledby="activity-form-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => void submit(event)}>
      <div className="dialog-heading"><h2 id="activity-form-title">Record {kind}</h2><button type="button" aria-label="Close record form" onClick={onClose} disabled={saving}>×</button></div>
      <fieldset disabled={saving}>
        {!subject && <label>Type <select value={kind} onChange={event => setKind(event.target.value as ActivityInput["kind"])}><option value="observation">Observation</option><option value="decision">Decision</option></select></label>}
        <label>Name <input name="title" required maxLength={80} placeholder="A short, identifying name" /></label>
        <label>{kind === "application" ? "What action changed?" : kind === "correction" ? "What needs correcting?" : "What happened or was decided?"}<textarea name="detail" required maxLength={4000} rows={3} /></label>
        {(kind === "application" || kind === "outcome") && <label>Task / run reference <input name="runId" required maxLength={100} defaultValue={runId} readOnly={Boolean(runId)} placeholder="A stable reference to this task or run" /></label>}
        <div className="form-row"><label>Evidence reference <input name="reference" required maxLength={500} placeholder="Test, commit, ticket or owner direction" /></label><label>Recorded by <input name="actor" maxLength={100} pattern="[\w.\-]+" placeholder="local-ui" /></label></div>
        <label>What does that evidence establish? <textarea name="evidence" required maxLength={1000} rows={2} /></label>
        {kind === "outcome" && <>
          <label>Reported result <select name="assessment" defaultValue="inconclusive"><option value="inconclusive">Inconclusive</option><option value="helped">Helped</option><option value="no_change">No change</option><option value="regressed">Regressed</option></select></label>
          <label>Comparison and limits <textarea name="comparison" required maxLength={2000} rows={3} placeholder="What baseline or independent check supports this result? What remains uncertain?" /></label>
          <details><summary>Add a measured comparison</summary><div className="form-row"><label>Measure <input name="metric" maxLength={80} placeholder="Retries" /></label><label>Unit <input name="unit" maxLength={40} placeholder="calls" /></label><label>Before <input name="before" type="number" step="any" /></label><label>After <input name="after" type="number" step="any" /></label></div></details>
        </>}
      </fieldset>
      {error && <p role="alert" className="error-message">{error}</p>}
      <p className="muted form-note">This adds a sourced report to Catalog and Timeline. It does not publish a lesson or grant approval. “Recorded by” is a self-reported label in this local app.</p>
      <div className="dialog-actions"><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save record"}</button></div>
    </form>
  </dialog>;
}
