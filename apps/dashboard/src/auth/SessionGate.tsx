import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AUTH_EXPIRED_EVENT, getSession, SessionError, signIn, signOut, type Session } from "./session.js";
import { SessionContext } from "./SessionContext.js";
import "./auth.css";

type ReadySession = Extract<Session, { authenticated: true }>;
type State = { status: "checking" } | { status: "ready"; session: ReadySession } | { status: "signed-out"; message?: string } | { status: "unavailable"; message: string };
const message = (error: unknown) => error instanceof SessionError ? error.message : "The team API is unavailable. Please retry.";

export function SessionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const control = new AbortController();
    setState({ status: "checking" });
    getSession(control.signal).then(session => {
      if (!control.signal.aborted) setState(session.authenticated ? { status: "ready", session } : { status: "signed-out" });
    }).catch(error => {
      if (!control.signal.aborted) setState(error instanceof SessionError && error.kind === "unauthorized" ? { status: "signed-out" } : { status: "unavailable", message: message(error) });
    });
    return () => control.abort();
  }, [attempt]);

  useEffect(() => {
    const expired = () => {
      setActionError("");
      setState(current => {
        if (current.status === "unavailable") return current;
        return current.status === "ready" && current.session.mode === "local"
          ? { status: "unavailable", message: "The local API rejected its configured credentials. Check the server connection and retry." }
          : { status: "signed-out", message: "Your session expired. Sign in to continue." };
      });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const token = String(new FormData(form).get("token") ?? "").trim();
    if (!token) return;
    form.reset();
    setBusy(true); setActionError("");
    try {
      const session = await signIn(token);
      if (session.authenticated) setState({ status: "ready", session });
      else setActionError("That access token was not accepted. Check it and try again.");
    } catch (error) { setActionError(message(error)); }
    finally { setBusy(false); }
  }

  async function leave() {
    if (busy) return;
    setBusy(true); setActionError("");
    try {
      const session = await signOut();
      if (session.authenticated) setActionError("Sign-out was not completed. Please retry.");
      else setState({ status: "signed-out" });
    } catch (error) { setActionError(message(error)); }
    finally { setBusy(false); }
  }

  if (state.status === "ready") {
    if (state.session.mode === "local") return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>;
    return <SessionContext.Provider value={state.session}><div className="team-session-shell">
      <div className="team-session-bar" aria-label="Team session"><span>{state.session.actorId} <span className="team-session-role">· {state.session.role}</span></span>
        {actionError && <span role="alert">{actionError}</span>}
        <button type="button" onClick={() => void leave()} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button>
      </div>{children}
    </div></SessionContext.Provider>;
  }

  return <main className="team-auth">
    <a className="team-auth-brand" href="/">Team Memory</a>
    {state.status === "checking" ? <p role="status">Connecting to the team…</p> : state.status === "unavailable" ? <section aria-labelledby="connection-heading">
      <h1 id="connection-heading">Connection unavailable</h1><p role="alert">{state.message}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry connection</button>
    </section> : <section aria-labelledby="signin-heading">
      <h1 id="signin-heading">Team sign-in</h1><p>Use your team access token to open the workspace.</p>
      {state.message && <p role="status">{state.message}</p>}
      <form onSubmit={event => void submit(event)}>
        <label htmlFor="team-token">Access token</label>
        <div className="team-auth-entry"><input id="team-token" name="token" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy} aria-describedby={actionError ? "signin-error" : undefined} /><button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></div>
      </form>
      {actionError && <p id="signin-error" role="alert">{actionError}</p>}
    </section>}
  </main>;
}
