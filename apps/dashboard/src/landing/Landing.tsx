import "./landing.css";

const repo = "https://github.com/Shazam6565/mongo-db-hackathon-Xchange";
const views = [
  { name: "Catalog", href: "/", text: "Tickets and lessons for the project, with evidence and history on each record." },
  { name: "Canvas", href: "/?view=canvas", text: "Shared maps of notes, catalog references and labeled connections." },
  { name: "Timeline", href: "/?view=timeline", text: "Observations, decisions, lesson applications and measured outcomes, by actor." },
  { name: "Harness", href: "/?view=harness", text: "The active lesson version, its history and rollback." },
] as const;
const loop = [
  ["Observe", "An agent records what it saw, decided and measured while working a ticket."],
  ["Propose", "A lesson candidate is submitted with the evidence behind it."],
  ["Evaluate", "The candidate is scored against a fixed suite. A version-checked gate publishes or rejects it."],
  ["Publish", "A passing lesson joins the active harness version, audited and reversible."],
  ["Apply", "Every teammate's agent loads the active lessons, ordered by relevance to its own ticket."],
] as const;

export function Landing() {
  return <div className="landing">
    <header className="landing-frame">
      <a className="landing-brand" href="/about"><span className="landing-mark" aria-hidden="true">tm</span>Team Memory</a>
      <nav aria-label="Workspace">{views.map(view => <a key={view.name} href={view.href}>{view.name}</a>)}</nav>
      <a className="landing-open" href="/">Open workspace</a>
    </header>

    <main>
      <section className="landing-intro" aria-labelledby="landing-title">
        <h1 id="landing-title">One engineer's agent learns a lesson. The whole team's agents apply it.</h1>
        <p>Team Memory is shared, tested memory for coding agents. Engineers work in separate sessions and checkouts.
          Lessons from one engineer's work are stored in MongoDB Atlas, scored against a fixed evaluation suite,
          published as a versioned harness and loaded by every teammate's agent through MCP.</p>
        <p className="landing-meta">MongoDB hackathon · Recursive Harnessing track · Pi, TypeScript, MongoDB Atlas</p>
      </section>

      <section aria-labelledby="landing-loop">
        <h2 id="landing-loop">How it works</h2>
        <ol className="landing-loop">{loop.map(([step, text]) => <li key={step}><strong>{step}</strong><span>{text}</span></li>)}</ol>
      </section>

      <section aria-labelledby="landing-views">
        <h2 id="landing-views">The workspace</h2>
        <ul className="landing-views">{views.map(view => <li key={view.name}><a href={view.href}>{view.name}</a><span>{view.text}</span></li>)}</ul>
      </section>

      <section aria-labelledby="landing-stack">
        <h2 id="landing-stack">Built on</h2>
        <ul className="landing-stack">
          <li><strong>MongoDB Atlas</strong><span>Lessons, tickets, activity and canvases. Vector Search with automated Voyage embeddings orders lessons by relevance to a ticket.</span></li>
          <li><strong>TypeScript API</strong><span>Scoped per team and project, with individual credentials and roles. Hosted on Vercel.</span></li>
          <li><strong>MCP server</strong><span>One tool surface for Claude Code, Codex and Pi, over HTTP or stdio. Atlas credentials never leave the backend.</span></li>
        </ul>
      </section>

      <section aria-labelledby="landing-connect">
        <h2 id="landing-connect">Connect</h2>
        <ol className="landing-connect">
          <li><a href="/">Open the workspace</a>. Anyone with the link can read it.</li>
          <li>Sign in with your personal access token to add records, edit canvases or publish lessons.</li>
          <li>Connect your agent. For Claude Code:</li>
        </ol>
        <pre><code>{`claude mcp add --transport http --scope user xchange https://mongo-db-hackathon-xchange.vercel.app/mcp --header "Authorization: Bearer $TEAM_API_TOKEN"`}</code></pre>
        <p>Codex, Pi and plain scripts are covered in the <a href={`${repo}#work-on-the-hosted-workspace`}>README</a>.</p>
      </section>
    </main>

    <footer className="landing-footer">
      <span>Team Memory</span>
      <nav aria-label="Links"><a href={repo}>Source</a><a href={`${repo}/blob/main/docs/team-access.md`}>Team access</a><a href={`${repo}/blob/main/docs/mcp-plugin.md`}>MCP plugin</a></nav>
    </footer>
  </div>;
}
