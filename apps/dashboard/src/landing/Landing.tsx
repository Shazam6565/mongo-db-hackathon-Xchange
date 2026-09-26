import { Component, useEffect, useState, type ReactNode } from "react";
import { AppFrame } from "../AppFrame.js";
import { ApiError, errorMessage, loadCatalog } from "../catalog/api.js";
import "./landing.css";

type Workspace = Awaited<ReturnType<typeof loadCatalog>>;
type Live = { state: "loading" } | { state: "ready"; data: Workspace } | { state: "error"; message: string };

const repo = "https://github.com/Shazam6565/mongo-db-hackathon-Xchange";
const host = "https://mongo-db-hackathon-xchange.vercel.app";
// Records in the hosted workspace that this page points judges at.
const link = {
  recap: "/?item=observation%3A7c1e9a52-3b4d-4f6e-8a1b-2c3d4e5f6c01",
  report: "/?item=observation%3A72d75e8b-ff2e-4a0d-a55c-18fc115e7d52",
  lesson: "/?item=lesson%3A6a9be369-ee3a-52dc-af40-f92186f7c145",
  compare: "/?item=ticket%3Afe9e4e5b-d1bf-54e3-9430-befa27531e8f",
  suite: "/?item=ticket%3Abcca78bc-8567-53fa-a479-a7be2dafb718",
  realtime: "/?item=ticket%3Af8ed39cd-1ed2-5f0c-bffe-8a127596531e",
} as const;
const connect = `claude mcp add --transport http --scope user xchange ${host}/mcp --header "Authorization: Bearer $TEAM_API_TOKEN"`;

const problems = [
  ["Agents forget between sessions.", "Every session starts from zero. The same mistake is made again by the same engineer’s agent tomorrow, and by a teammate’s agent today."],
  ["Teams cannot tell what was verified.", "Memory files and prompt tweaks spread by copy and paste. Nobody knows which advice was tested, on what, or whether it still holds."],
  ["Shared memory without a gate drifts.", "If any agent can write to everyone’s instructions, one bad lesson degrades the whole team. Memory needs a test, a version and a way back."],
] as const;

const steps = [
  ["Observe", "While working a ticket, an agent records what it saw, decided and measured. Each record names its actor and its evidence."],
  ["Propose", "An engineer or agent submits a lesson candidate with the evidence behind it. A candidate never reaches another agent on its own."],
  ["Evaluate", "The gate scores the candidate against a fixed suite held outside every agent’s context, and checks the version it expects to change."],
  ["Publish", "A passing lesson becomes the next harness version in one Atlas transaction, with an audit event. A failing one stays out."],
  ["Apply", "Every teammate’s agent loads the active version through MCP as native skills, ranked by relevance to its own ticket. Outcomes feed the next round."],
] as const;

const guarantees = [
  ["A gate the agents cannot move.", "The evaluation suite is versioned and kept out of every agent’s context. A lesson that tells an agent to skip a required check is rejected."],
  ["One version at a time.", "Publishing checks the expected version, so two agents cannot race each other into an inconsistent harness. Forty concurrent shares produced forty contiguous versions."],
  ["A way back.", "Rolling back a version removes its lesson from every agent’s next run and writes an audit event that says who did it and when."],
] as const;

const proof: ReadonlyArray<readonly [string, string, "recap" | "report"]> = [
  ["Built in one day", "39 commits by 3 engineers between 10:33 and 15:56 on 26 September 2026", "recap"],
  ["Test suite", "89 tests pass against a MongoDB replica set; 82 without one", "recap"],
  ["40 agents share at once", "40 lessons published, harness v0 to v40 with no gap and nothing lost", "report"],
  ["30 agents evaluate one candidate", "One succeeds and 29 receive 409. Rollback and canvas saves behave the same way", "report"],
  ["50 identical retries", "One record, because every create carries an Idempotency-Key", "report"],
  ["2,000 malformed requests", "No 5xx responses; the API stayed healthy throughout", "report"],
  ["Production, read-only", "27 of 27 checks pass on this deployment: guest reads 200, writes and memory 401", "report"],
  ["Throughput, one local process", "1,620 reads per second at p99 83 ms; 2,882 writes per second", "report"],
];
const proofSource = { recap: ["Shipping recap", link.recap], report: ["End-to-end and stress report", link.report] } as const;

const collections = [
  ["lessons", "candidates and published lessons, each with evidence, version and status"],
  ["harness_versions", "the ordered history of what agents ran with"],
  ["evaluations", "every gate result, tied to a lesson version and a suite version"],
  ["activity_records", "observations, decisions, applications and outcomes, by actor"],
  ["audit_events", "one event per transition: proposed, published, rolled back, consumed"],
  ["tickets, canvases", "the work itself and the shared maps drawn around it"],
] as const;

const atlas = [
  ["Publication is one transaction.", "Lesson status, evaluation, harness version and audit event commit together or not at all."],
  ["Relevance without a model key.", "Atlas Vector Search with automated Voyage embeddings ranks lessons for the ticket an agent holds. The API never touches an embedding model."],
  ["Retries are safe.", "Each create stores its Idempotency-Key, so an identical retry returns the original record instead of a duplicate."],
  ["Stale writes lose.", "Canvas saves carry a revision. A stale save gets 409 and keeps its draft for the person to merge."],
  ["Scope is derived, never supplied.", "Every document carries teamId and projectId taken from the credential, not from the request body."],
] as const;

const next = [
  ["Compare agent runs with and without a lesson.", "Today the gate scores lesson text against the suite. The next step runs held-out tickets both ways and publishes only on a measured improvement.", link.compare],
  ["Cover more components in the held-out suite.", "Lessons outside the first two components cannot pass yet, which is why the hosted harness starts at version 0 until the owner publishes the first one.", link.suite],
  ["Tell running agents when a lesson is published.", "An Atlas change stream would replace the refresh at the start of each run.", link.realtime],
] as const;

export function Landing() {
  const [live, setLive] = useState<Live>({ state: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    loadCatalog(controller.signal)
      .then(data => setLive({ state: "ready", data }))
      .catch(error => { if (!controller.signal.aborted) setLive({ state: "error", message: error instanceof ApiError && error.status === 401 ? "This workspace is not open to guest reads right now." : errorMessage(error) }); });
    return () => controller.abort();
  }, []);
  const data = live.state === "ready" ? live.data : undefined;

  return <div className="landing">
    <AppFrame active="About" data={data && { storage: data.storage, storageLabel: data.storageLabel, scope: data.scope }} error={live.state === "error"} />

    <main>
      <section className="landing-hero landing-wrap" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="landing-context">Team Xchange at the MongoDB NYC hackathon, Recursive Harnessing track. Built on 26 September 2026.</p>
          <h1 id="landing-title">One engineer’s agent learns a lesson. Every teammate’s agent applies it.</h1>
          <p className="landing-lede">Team Memory turns what coding agents learn on the job into shared memory that is tested before it is trusted.
            Lessons are stored in MongoDB Atlas, scored against a fixed suite, published as a versioned harness and loaded by every
            agent on the team through MCP. Nothing reaches an agent without passing the gate, and anything can be rolled back.</p>
          <p className="landing-actions"><a className="landing-primary" href="/">Open the live workspace</a><a className="landing-secondary" href="#judge">Judge it in 60 seconds</a></p>
        </div>
        <Quiet><LivePanel live={live} /></Quiet>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="landing-problem">
        <h2 id="landing-problem">The problem</h2>
        <div className="landing-problems">{problems.map(([title, text]) => <div key={title}><h3>{title}</h3><p>{text}</p></div>)}</div>
        <p className="landing-answer">Team Memory is the fix: evidence goes in, tested lessons come out, and every agent runs the same audited version.</p>
      </section>

      <section className="landing-band" aria-labelledby="landing-loop">
        <div className="landing-wrap">
          <h2 id="landing-loop">How it works: agents improve the harness that runs them</h2>
          <LoopFigure />
          <ol className="landing-steps">{steps.map(([name, text]) => <li key={name}><strong>{name}</strong><span>{text}</span></li>)}</ol>
        </div>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="landing-recursive">
        <h2 id="landing-recursive">What makes it recursive, and what keeps it safe</h2>
        <p className="landing-prose">The harness is the set of lessons, instructions and verification steps an agent runs with. In Team Memory the agents’ own work
          produces the evidence, the evidence becomes candidates, and the candidates that pass become the next harness. The loop cannot run away because three things are fixed.</p>
        <ul className="landing-guarantees">{guarantees.map(([lead, text]) => <li key={lead}><strong>{lead}</strong> {text}</li>)}</ul>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="landing-proof">
        <h2 id="landing-proof">What we measured</h2>
        <p className="landing-prose">Every result below is a record in the workspace, with the command or scenario that produced it.</p>
        <div className="landing-table-scroll"><table className="landing-proof">
          <thead><tr><th scope="col">Measurement</th><th scope="col">Result</th><th scope="col">Recorded in</th></tr></thead>
          <tbody>{proof.map(([what, result, source]) => <tr key={what}><th scope="row">{what}</th><td>{result}</td><td><a href={proofSource[source][1]}>{proofSource[source][0]}</a></td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="landing-atlas">
        <h2 id="landing-atlas">Why MongoDB Atlas</h2>
        <div className="landing-atlas">
          <div>
            <h3>What lives there</h3>
            <ul className="landing-collections">{collections.map(([name, text]) => <li key={name}><code>{name}</code><span>{text}</span></li>)}</ul>
          </div>
          <div>
            <h3>What it guarantees</h3>
            <ul className="landing-guarantees">{atlas.map(([lead, text]) => <li key={lead}><strong>{lead}</strong> {text}</li>)}</ul>
          </div>
        </div>
        <p className="landing-prose">The API runs on Vercel and is the only component that holds Atlas credentials. Agents get individual grants with a role; the browser gets a session. Anyone with the link can read.</p>
      </section>

      <section id="judge" className="landing-wrap landing-section" aria-labelledby="landing-judge">
        <h2 id="landing-judge">Judge it in 60 seconds</h2>
        <ol className="landing-judge">
          <li><h3><a href="/">Open the Catalog</a></h3><p>Tickets and lessons, each with its evidence and history. Open <a href={link.lesson}>Publishing needs a MongoDB replica set</a> to see a candidate backed by a commit and a test.</p></li>
          <li><h3><a href="/?view=timeline">Read the Timeline</a></h3><p>Observations, decisions and outcomes by actor. The <a href={link.recap}>shipping recap</a> and the <a href={link.report}>end-to-end report</a> for this very deployment are records in the product, not slides.</p></li>
          <li><h3><a href="/?view=harness">Open the Harness</a></h3><p>The active version and every earlier one. A lesson only gets here through the gate, and an evaluator can roll it back in one click.</p></li>
          <li><h3>Connect your own agent</h3><p>With a credential from the owner, one command adds the hosted MCP server to Claude Code. Then <code>xchange_access</code> shows your name and role, and <code>xchange_load_memory</code> returns the active lessons.</p><pre><code>{connect}</code></pre></li>
          <li><h3>Break something</h3><p>Save a canvas from a stale tab: 409, and the draft is kept. Retry a create with the same key: still one record. Roll back a version: gone from every agent’s next run, with an audit event that names you.</p></li>
        </ol>
      </section>

      <section className="landing-wrap landing-section" aria-labelledby="landing-next">
        <h2 id="landing-next">What is not done yet</h2>
        <ul className="landing-next">{next.map(([lead, text, href]) => <li key={lead}><strong><a href={href}>{lead}</a></strong> {text}</li>)}</ul>
        <p className="landing-prose">Every open item is a ticket in the <a href="/">Catalog</a>, filed by the same agents that built the product.</p>
      </section>
    </main>

    <footer className="landing-footer landing-wrap">
      <span>Team Memory, by Team Xchange</span>
      <nav aria-label="Links"><a href={repo}>Source</a><a href={`${repo}/blob/main/docs/team-access.md`}>Team access</a><a href={`${repo}/blob/main/docs/mcp-plugin.md`}>MCP plugin</a><a href={`${repo}/blob/main/docs/architecture.md`}>Architecture</a></nav>
    </footer>
  </div>;
}

function LivePanel({ live }: { live: Live }) {
  const data = live.state === "ready" ? live.data : undefined;
  const published = data ? data.lessons.filter(lesson => lesson.status === "published").length : 0;
  return <aside className="landing-live" aria-labelledby="landing-live-title">
    <h2 id="landing-live-title">Live from the Atlas Sandbox</h2>
    {live.state === "error"
      ? <p className="landing-live-note" role="status">Could not read the workspace right now. {live.message} The rest of this page does not depend on it.</p>
      : <dl aria-busy={!data} className={data ? "ready" : ""}>
        <div><dt>Storage</dt><dd><span className={`landing-dot ${data ? "on" : ""}`} aria-hidden="true" />{data ? data.storageLabel ?? "MongoDB" : "Connecting…"}</dd></div>
        <div><dt>Workspace</dt><dd>{data ? `${data.scope.teamId} / ${data.scope.projectId}` : "…"}</dd></div>
        <div><dt>Tickets</dt><dd>{data ? data.tickets.length : "…"}</dd></div>
        <div><dt>Lessons</dt><dd>{data ? <>{data.lessons.length} <small>{published} published</small></> : "…"}</dd></div>
        <div><dt>Activity records</dt><dd>{data ? (data.activity.length >= 100 ? "100+" : data.activity.length) : "…"}</dd></div>
      </dl>}
    <p className="landing-live-note">Read from this deployment’s API as a guest, the same way the workspace reads it. Sign in to change anything.</p>
  </aside>;
}

const nodes = [
  { x: 26, title: "Agents at work", sub: "Claude Code, Codex, Pi", store: "skills loaded via MCP", stack: true },
  { x: 228, title: "Evidence", sub: "observations, outcomes", store: "activity_records" },
  { x: 430, title: "Lesson candidate", sub: "with its evidence", store: "lessons" },
  { x: 632, title: "Gate", sub: "fixed suite, version check", store: "evaluations", gate: true },
  { x: 834, title: "Harness vN", sub: "what agents run with", store: "harness_versions" },
] as const;
const arrows = [["Observe", 197], ["Propose", 399], ["Evaluate", 601], ["Publish", 803]] as const;
const mono = "ui-monospace, Menlo, Consolas, monospace";

function LoopFigure() {
  return <figure className="landing-loop-figure">
    <svg viewBox="0 0 1000 322" role="img" aria-labelledby="landing-loop-title">
      <title id="landing-loop-title">Agents produce evidence, evidence becomes lesson candidates, the gate evaluates them, passing lessons become the next harness version, and every agent loads that version. MongoDB Atlas holds every record and audit event.</title>
      <defs><marker id="landing-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#cfe0d5" /></marker></defs>
      {nodes.map(node => <g key={node.title}>
        {"stack" in node && <><rect x={node.x + 10} y={46} width={140} height={72} rx={8} fill="none" stroke="#9fbfae" strokeOpacity={.35} /><rect x={node.x + 5} y={51} width={140} height={72} rx={8} fill="#17322a" stroke="#9fbfae" strokeOpacity={.6} /></>}
        <rect x={node.x} y={56} width={140} height={72} rx={8} fill={"gate" in node ? "#d9e8de" : "#1f4035"} stroke={"gate" in node ? "#d9e8de" : "#9fbfae"} strokeWidth={"gate" in node ? 2 : 1.2} />
        <text x={node.x + 70} y={86} textAnchor="middle" fontSize={15} fontWeight={700} fill={"gate" in node ? "#17322a" : "#f2f6f3"}>{node.title}</text>
        <text x={node.x + 70} y={106} textAnchor="middle" fontSize={11.5} fill={"gate" in node ? "#315e4d" : "#b7cbbf"}>{node.sub}</text>
        <text x={node.x + 70} y={150} textAnchor="middle" fontSize={11.5} fontFamily={mono} fill="#b7cbbf">{node.store}</text>
      </g>)}
      {arrows.map(([label, mid]) => <g key={label}>
        <path d={`M${mid - 27} 92H${mid + 24}`} stroke="#cfe0d5" strokeWidth={1.6} markerEnd="url(#landing-arrow)" />
        <text x={mid} y={40} textAnchor="middle" fontSize={13} fontWeight={700} fill="#f2f6f3">{label}</text>
      </g>)}
      <path d="M904 128V208H96V134" fill="none" stroke="#cfe0d5" strokeWidth={1.6} markerEnd="url(#landing-arrow)" />
      <text x={500} y={230} textAnchor="middle" fontSize={13} fontWeight={700} fill="#f2f6f3">Apply<tspan fontWeight={400} fill="#b7cbbf">: every agent loads the active version as native skills, through MCP</tspan></text>
      <text x={914} y={172} fontSize={11.5} fill="#b7cbbf">roll back: vN−1</text>
      <rect x={26} y={258} width={948} height={46} rx={8} fill="#1f4035" stroke="#9fbfae" strokeOpacity={.6} />
      <text x={500} y={286} textAnchor="middle" fontSize={13} fill="#f2f6f3">MongoDB Atlas Sandbox holds every record above and writes an audit event for each transition<tspan fontFamily={mono} fill="#b7cbbf"> (audit_events)</tspan></text>
    </svg>
  </figure>;
}

/** The live panel is a nicety: if it ever fails to render, the page must still stand. */
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
