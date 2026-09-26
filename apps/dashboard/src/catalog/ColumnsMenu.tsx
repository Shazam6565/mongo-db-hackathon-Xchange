import { defaultViewFor, type ColumnDef, type TableView } from "./model.js";

/** The Columns popover shared by record tables: show or hide, reorder, resize and wrap. */
export function ColumnsMenu<Id extends string>({ columns, view, locked, onChange }: { columns: readonly ColumnDef<Id>[]; view: TableView<Id>; locked: Id; onChange: (view: TableView<Id>) => void }) {
  return <details className="popover columns-popover"><summary>Columns</summary><div className="popover-panel columns-panel">
    <div className="panel-heading"><strong>Columns</strong><button onClick={() => onChange(defaultViewFor(columns))}>Reset</button></div>
    <label className="wrap-toggle"><input type="checkbox" checked={view.wrap} onChange={event => onChange({ ...view, wrap: event.target.checked })} />Wrap text</label>
    {view.order.map((id, index) => { const column = columns.find(c => c.id === id)!; return <div className="column-setting" key={id}>
      <label><input type="checkbox" checked={!view.hidden.includes(id)} disabled={id === locked} onChange={event => onChange({ ...view, hidden: event.target.checked ? view.hidden.filter(value => value !== id) : [...view.hidden, id] })} />{column.label}</label>
      <div className="column-moves">{([-1, 1] as const).map(direction => <button key={direction} className="icon-button" disabled={index + direction < 0 || index + direction >= view.order.length} aria-label={`Move ${column.label} ${direction === -1 ? "left" : "right"}`} onClick={() => { const next = [...view.order]; [next[index], next[index + direction]] = [next[index + direction]!, next[index]!]; onChange({ ...view, order: next }); }}>{direction === -1 ? "←" : "→"}</button>)}</div>
      <input type="range" aria-label={`${column.label} width`} min={100} max={600} step={10} value={view.widths[id] ?? column.width} onChange={event => onChange({ ...view, widths: { ...view.widths, [id]: Number(event.target.value) } })} />
    </div>; })}<p className="muted">Saved in this browser for this project.</p>
  </div></details>;
}
