import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { HarnessVersionRecord } from "../../../../packages/contracts/src/harness.js";
import { AppFrame } from "../AppFrame.js";
import { errorMessage, request } from "../catalog/api.js";
import { ColumnsMenu } from "../catalog/ColumnsMenu.js";
import { setFacet, usePopoverDismiss, useQuery } from "../catalog/hooks.js";
import { defaultViewFor, readViewFor, type TableView } from "../catalog/model.js";
import { canEvaluate, useSession } from "../auth/SessionContext.js";
import { EventDetails } from "./EventDetails.js";
import { feedColumns, feedKinds, filterFeed, kindLabel, kindTone, projectEvents, type FeedColumnId, type FeedItem } from "./feed.js";
import { loadFeed } from "./load.js";
import "../catalog/catalog.css";
import "../activity/activity.css";
import "../timeline/timegraph.css";

type Data = Awaited<ReturnType<typeof loadFeed>>;
const pageSize = 20;
const lessonLink = (id: string) => `/?item=${encodeURIComponent(`lesson:${id}`)}`;
const defaultView = defaultViewFor(feedColumns);

// Activity: every audited harness action, read from MongoDB, in the catalog table. Versions: the
// active version with rollback, and the immutable version history.
export function Harness() {
  const session = useSession();
  // Mirrors the API: rollback is evaluator-only on the hosted API; the local owner may roll back.
  const canRollback = canEvaluate(session);
  usePopoverDismiss();
  const { query, update } = useQuery();
  const mode = query.get("mode") === "versions" ? "versions" : "activity";
  const [data, setData] = useState<Data>();
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [pending, setPending] = useState(""), [notice, setNotice] = useState("");
  const [view, setView] = useState<TableView<FeedColumnId>>(defaultView);
  const controller = useRef<AbortController | null>(null);
  const storageKey = data ? `team-memory:harness-feed:v1:${encodeURIComponent(data.harness.scope.teamId)}:${encodeURIComponent(data.harness.scope.projectId)}` : null;

  const refresh = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController(); controller.current = active;
    setLoading(true); setError("");
    try { const result = await loadFeed(active.signal); if (!active.signal.aborted) setData(result); }
    catch (failure) { if (!active.signal.aborted) setError(errorMessage(failure)); }
    finally { if (!active.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); return () => controller.current?.abort(); }, [refresh]);
  useEffect(() => {
    if (!storageKey) return;
    try { const value = JSON.parse(localStorage.getItem(storageKey) ?? "null"); setView(value?.version === 1 ? readViewFor(feedColumns, "summary", value.view) : defaultView); }
    catch { setView(defaultView); }
  }, [storageKey]);
  function changeView(next: TableView<FeedColumnId>) {
    setView(next);
    if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, view: next })); }
    catch { setNotice("Column preferences could not be saved in this browser."); }
  }
  const titles = useMemo(() => new Map([...data?.lessons ?? []].map(([id, lesson]) => [id, lesson.title])), [data]);
  const items = useMemo(() => data ? projectEvents(data.events, titles) : [], [data, titles]);
  const matching = useMemo(() => filterFeed(items, query), [items, query]);
  const actors = useMemo(() => [...new Set(items.map(item => item.actor))].sort((a, b) => a.localeCompare(b)), [items]);
  const selection = query.get("item");
  const selected = items.find(item => item.id === selection);
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const rawPage = Number(query.get("page") ?? 1);
  const page = Math.min(pageCount, Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1);
  const shown = matching.slice((page - 1) * pageSize, page * pageSize);
  const visibleColumns = view.order.map(id => feedColumns.find(column => column.id === id)!).filter(column => !view.hidden.includes(column.id));
  const sort = feedColumns.find(column => column.id === query.get("sort"))?.id ?? "at";
  const order = query.get("order") === "asc" ? "asc" : "desc";
  const filtered = Boolean(query.get("q") || query.getAll("type").length || query.getAll("actor").length);
  function clearFilters() { update(params => { ["q", "type", "actor", "page"].forEach(key => params.delete(key)); }); }
  function closeDetails() {
    const link = selection ? document.getElementById(`event-${selection}`) : null;
    update(params => params.delete("item")); link?.focus();
  }
  function openItem(event: MouseEvent<HTMLAnchorElement>, item: FeedItem) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); update(params => params.set("item", item.id));
  }
  function itemHref(item: FeedItem) { const params = new URLSearchParams(query); params.set("item", item.id); return `?${params}`; }
  function chooseMode(next: "activity" | "versions") {
    update(params => { if (next === "versions") params.set("mode", "versions"); else params.delete("mode"); params.delete("item"); }, true);
  }

  async function rollback(lessonId: string) {
    if (!data) return;
    const title = titles.get(lessonId) ?? lessonId;
    if (!window.confirm(`Roll back “${title}”? Agents stop receiving it from harness v${data.harness.version + 1}. The lesson keeps its evaluation.`)) return;
    setPending(lessonId); setError("");
    try {
      await request("/v1/harness/rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: data.harness.version, lessonId }) });
      await refresh();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setPending(""); }
  }
  const describe = (version: HarnessVersionRecord) => `${version.reason === "publish" ? "Added" : "Rolled back"} ${titles.get(version.lessonId) ?? version.lessonId}`;
  const modeSwitch = <div className="tg-segmented" role="group" aria-label="Harness view">{(["activity", "versions"] as const).map(value =>
    <button key={value} aria-pressed={mode === value} onClick={() => chooseMode(value)}>{value === "activity" ? "Activity" : "Versions"}</button>)}</div>;
  const state = data?.harness;

  return <div className="catalog-app"><a className="skip-link" href="#harness-content">Skip to harness</a>
    <AppFrame active="Harness" data={data && !error ? { ...data.health, scope: data.harness.scope } : undefined} error={Boolean(error)} />
    <main id="harness-content" className="catalog-main" tabIndex={-1}>
      {mode === "activity" ? <>
        <div className="catalog-toolbar">
          {modeSwitch}
          <label className="search-field"><span className="sr-only">Search harness activity</span><span aria-hidden="true">⌕</span><input type="search" placeholder="Search events, actors, lessons…" value={query.get("q") ?? ""} onChange={event => update(params => { if (event.target.value) params.set("q", event.target.value); else params.delete("q"); params.delete("page"); }, true)} /></label>
          <details className="popover"><summary>Type{query.getAll("type").length ? ` · ${query.getAll("type").length}` : ""}</summary><div className="popover-panel filter-panel">{feedKinds.map(kind => <label key={kind}><input type="checkbox" checked={query.getAll("type").includes(kind)} onChange={event => update(params => setFacet(params, "type", kind, event.target.checked))} />{kindLabel(kind)}</label>)}</div></details>
          <details className="popover"><summary>Actor{query.getAll("actor").length ? ` · ${query.getAll("actor").length}` : ""}</summary><div className="popover-panel filter-panel">{actors.length ? actors.map(actor => <label key={actor}><input type="checkbox" checked={query.getAll("actor").includes(actor)} onChange={event => update(params => setFacet(params, "actor", actor, event.target.checked))} />{actor}</label>) : <span className="muted">No actors recorded yet</span>}</div></details>
          <div className="toolbar-spacer" />
          <ColumnsMenu columns={feedColumns} view={view} locked="summary" onChange={changeView} />
          <button onClick={() => void refresh()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
        {filtered && <div className="active-filters" aria-label="Active filters">
          {query.get("q") && <button onClick={() => update(params => { params.delete("q"); params.delete("page"); })}>Search: {query.get("q")} ×</button>}
          {query.getAll("type").map(value => <button key={`type:${value}`} aria-label={`Remove ${kindLabel(value as FeedItem["kind"]) ?? value} type filter`} onClick={() => update(params => setFacet(params, "type", value, false))}>{kindLabel(value as FeedItem["kind"]) ?? value} ×</button>)}
          {query.getAll("actor").map(value => <button key={`actor:${value}`} aria-label={`Remove ${value} actor filter`} onClick={() => update(params => setFacet(params, "actor", value, false))}>{value} ×</button>)}
          <button className="text-button" onClick={clearFilters}>Clear all</button>
        </div>}
        {notice && <div className="notice" role="status">{notice}<button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
        {error && <div className="error-message" role="alert">{error} <button onClick={() => void refresh()}>Retry</button></div>}
        <div className={`catalog-workspace ${selection ? "has-details" : ""}`}>
          <div className="catalog-table-area" aria-busy={loading}>
            <div className={`table-scroll ${view.wrap ? "" : "compact"}`} tabIndex={0} role="region" aria-label="Harness activity">
              <table style={{ width: visibleColumns.reduce((sum, col) => sum + (view.widths[col.id] ?? col.width), 0) }}>
                <caption className="sr-only">Harness activity feed</caption>
                <colgroup>{visibleColumns.map(col => <col key={col.id} style={{ width: view.widths[col.id] ?? col.width }} />)}</colgroup>
                <thead><tr>{visibleColumns.map(col => <th key={col.id} scope="col" aria-sort={sort === col.id ? order === "asc" ? "ascending" : "descending" : "none"}><button onClick={() => update(params => { params.set("sort", col.id); params.set("order", sort === col.id && order === "asc" ? "desc" : "asc"); params.delete("page"); })}>{col.label}<span aria-hidden="true">{sort === col.id ? order === "asc" ? " ↑" : " ↓" : ""}</span></button></th>)}</tr></thead>
                <tbody>{!error && shown.map(item => <tr key={item.id} className={selection === item.id ? "selected-row" : ""}>{visibleColumns.map(col => <td key={col.id}>
                  {col.id === "summary" ? <a id={`event-${item.id}`} className="item-link" href={itemHref(item)} onClick={event => openItem(event, item)}>{item.summary}</a> : <Cell item={item} column={col.id} />}
                </td>)}</tr>)}</tbody>
              </table>
              {!loading && !error && matching.length === 0 && <div className="empty-state"><strong>{filtered ? "No matching events" : "No harness activity yet"}</strong><p>{filtered ? "Try another search or clear the filters." : "Events appear when a Pi agent loads shared memory, a lesson is proposed, evaluated or shared, or a harness version changes."}</p>{filtered && <button onClick={clearFilters}>Clear filters</button>}</div>}
              {loading && !data && <div className="empty-state" role="status">Loading harness activity…</div>}
            </div>
            <footer className="table-footer">
              <span>{error ? "Feed unavailable" : `${matching.length} ${filtered ? "matching" : "recorded"} event${matching.length === 1 ? "" : "s"}`}</span>
              <span className="window-note">{data?.truncated ? `Latest ${items.length} events from MongoDB; older events are not loaded` : `Every audited harness event, read from the audit_events collection${state ? ` · active harness v${state.version}` : ""}`}</span>
              <div className="pagination"><button aria-label="Previous page" disabled={page <= 1} onClick={() => update(params => params.set("page", String(page - 1)))}>←</button><span>{page} / {pageCount}</span><button aria-label="Next page" disabled={page >= pageCount} onClick={() => update(params => params.set("page", String(page + 1)))}>→</button></div>
            </footer>
          </div>
          {selection && (selected && data && !error ? <EventDetails item={selected} lessons={data.lessons} onClose={closeDetails} />
            : <aside className="item-details"><button onClick={closeDetails}>Close details</button><p role="status">{error ? "Refresh the feed to inspect this event." : loading ? "Loading event…" : "This event is not in the loaded feed. It may be older than the loaded window."}</p></aside>)}
        </div>
      </> : <>
        <div className="catalog-toolbar">{modeSwitch}<div className="toolbar-spacer" /><button disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button></div>
        <div className="harness-versions"><div className="timeline-content">
          <p className="timeline-caption">Agents load the active harness version: Pi injects it as context and <code>client.mjs sync-skills</code> installs it as skills. Publishing through the gate adds a lesson; rollback removes it without changing its evaluation. Version 0 means no change has been recorded yet, so every published lesson is active.</p>
          {error && <p role="alert" className="error-message">{error} <button onClick={() => void refresh()}>Retry</button></p>}
          {state && <>
            <h2>Active · v{state.version}</h2>
            {state.lessons.length ? <ol className="timeline-list">{state.lessons.map(ref => {
              const lesson = data?.lessons.get(ref.id);
              return <li key={ref.id}>{lesson ? <time dateTime={lesson.updatedAt} title="Published">{new Date(lesson.updatedAt).toLocaleString()}</time> : <span />}<div className="timeline-entry">
                <div className="history-meta"><span>Lesson v{ref.version}</span>{lesson && <span>Author: {lesson.authorId}</span>}{lesson && <span>Applies to: {lesson.appliesTo.join(", ") || "project-wide"}</span>}</div>
                <a href={lessonLink(ref.id)}>{lesson?.title ?? ref.id}</a>
                {lesson && <p className="record-prose">{lesson.lesson}</p>}
                {canRollback && <button disabled={Boolean(pending)} onClick={() => void rollback(ref.id)}>{pending === ref.id ? "Rolling back…" : "Roll back"}</button>}
              </div></li>;
            })}</ol> : <p className="muted">No lessons are active. Agents receive empty team memory until a candidate passes the gate.</p>}
            <h2>History</h2>
            {state.versions.length ? <ol className="timeline-list">{state.versions.map(version => <li key={version.id}>
              <time dateTime={version.createdAt}>{new Date(version.createdAt).toLocaleString()}</time><div className="timeline-entry">
                <div className="history-meta"><span>v{version.number}</span><span>By: {version.actorId}</span><span>{version.lessons.length} active</span></div>
                <a href={lessonLink(version.lessonId)}>{describe(version)}</a>
              </div></li>)}</ol> : <p className="muted">No harness changes recorded yet.</p>}
          </>}
          {loading && <p role="status">Loading harness…</p>}
        </div></div>
      </>}
    </main>
  </div>;
}
function Cell({ item, column }: { item: FeedItem; column: FeedColumnId }) {
  switch (column) {
    case "type": return <span className={`status status-${kindTone(item.kind)}`}>{item.type}</span>;
    case "harness": return <span className="cell-text">{item.harness || "—"}</span>;
    case "lesson": return item.lessonId ? <a className="cell-text" href={lessonLink(item.lessonId)}>{item.lesson}{item.lessonVersion ? ` · v${item.lessonVersion}` : ""}</a> : <span className="cell-text">—</span>;
    case "at": return <time dateTime={item.at} title={item.at}>{new Date(item.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>;
    case "loaded": return <span className="cell-text">{item.loaded ?? "—"}</span>;
    default: return <span className="cell-text">{item[column] || "—"}</span>;
  }
}
