import { useState } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import type { Workspace } from "../domain/contracts";
import type { cloudClient, CloudConfig } from "../sync/client";

export function Account({
  w,
  config,
  email,
  configure,
  client,
  runSync,
  signOut,
  status,
  notify,
  importClick,
  clear,
}: {
  w: Workspace | null;
  config: CloudConfig;
  email: string;
  configure: (c: CloudConfig) => void;
  client: ReturnType<typeof cloudClient>;
  runSync: () => void;
  signOut: () => void;
  status: string;
  notify: (s: string) => void;
  importClick: () => void;
  clear: (cloud: boolean) => void;
}) {
  const [url, setUrl] = useState(config.url),
    [key, setKey] = useState(config.key),
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [authBusy, setAuthBusy] = useState(false);

  async function auth(signup = false) {
    if (!client) return;
    setAuthBusy(true);
    try {
      const { error } = signup
        ? await client.auth.signUp({
            email: login,
            password,
            options: {
              emailRedirectTo: location.origin + import.meta.env.BASE_URL,
            },
          })
        : await client.auth.signInWithPassword({ email: login, password });
      if (error) throw error;
      setPassword("");
      notify(
        signup
          ? "Account request submitted. Check your email if confirmation is enabled."
          : "",
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <>
      <section className="gd-card gd-account-card">
        <div className="gd-account-card-head">
          <h2 className="gd-h2">Current dataset</h2>
          <p className="gd-muted">
            Refresh All in Excel, wait, recalculate, save, then import.
          </p>
        </div>
        <div className="gd-account-metrics">
          <div className="gd-account-metric">
            <small>Players</small>
            <strong>{w?.dataset?.tables.ModelPlayers.length ?? "None"}</strong>
          </div>
          <div className="gd-account-metric">
            <small>Source refresh</small>
            <span>
              {w?.dataset?.sourceUTC
                ? new Date(w.dataset.sourceUTC).toLocaleString()
                : "Unavailable"}
            </span>
          </div>
          <div className="gd-account-metric">
            <small>Imported</small>
            <span>
              {w?.dataset
                ? new Date(w.dataset.importedAt).toLocaleString()
                : "Not imported"}
            </span>
          </div>
          <div className="gd-account-metric">
            <small>Sync</small>
            <span className="gd-sync-status-pill">{status}</span>
          </div>
        </div>
        <div className="gd-account-actions">
          <button className="gd-cta" onClick={importClick}>
            <Upload size={16} />
            Import / replace
          </button>
          <button className="gd-pill" onClick={runSync} disabled={!email || !w}>
            Sync now
          </button>
          <button
            className="gd-button-subtle"
            disabled={!w}
            onClick={() => clear(false)}
          >
            Remove from this device
          </button>
          <button
            className="gd-button-danger"
            disabled={!email || !w}
            onClick={() => clear(true)}
          >
            Delete cloud workspace
          </button>
        </div>
        <p className="gd-muted">
          The app retains the current extracted dataset, not the Excel file. Older
          offline devices update when they reconnect. Provider backups follow
          your Supabase plan’s retention.
        </p>
      </section>
      <section className="gd-card gd-account-card">
        <div className="gd-account-card-head">
          <h2 className="gd-h2">Supabase synchronization</h2>
          <p className="gd-muted">
            Uses Trainwise’s Supabase project with separate fantasy storage.
          </p>
        </div>
        {!config.url && (
          <div className="notice warning">
            Cloud sync needs your Supabase project and the included database
            migration. Local import and analysis already work.
          </div>
        )}
        <p>
          Sign in with your Trainwise account once this project is configured.
          Fantasy keeps its own login session and workspace. Signing out here
          leaves your Trainwise sessions active.
        </p>
        <details open={!config.url}>
          <summary>Project configuration</summary>
          <p>
            Apply <code>supabase/migrations/001_workspace.sql</code> from this
            app’s repository in your selected project. Never enter a
            secret/service-role key.
          </p>
          <div className="gd-two-col">
            <label className="gd-control">
              <span>Project URL</span>
              <input
                className="gd-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-project.supabase.co"
              />
            </label>
            <label className="gd-control">
              <span>Publishable key</span>
              <input
                className="gd-input"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sb_publishable_…"
                autoComplete="off"
              />
            </label>
          </div>
          <button
            className="gd-pill"
            style={{ marginTop: "12px", width: "fit-content" }}
            onClick={() => {
              try {
                configure({ url, key });
              } catch (e) {
                notify(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Save public configuration
          </button>
        </details>
        {email ? (
          <div className="gd-signed-in">
            <CheckCircle2 size={22} />
            <p>
              Signed in as <b>{email}</b>
            </p>
            <button className="gd-pill" onClick={signOut}>
              Sign out and clear local account data
            </button>
          </div>
        ) : client ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void auth();
            }}
          >
            <div className="gd-two-col">
              <label className="gd-control">
                <span>Email</span>
                <input
                  className="gd-input"
                  type="email"
                  autoComplete="username"
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </label>
              <label className="gd-control">
                <span>Password</span>
                <input
                  className="gd-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            </div>
            <div className="gd-button-row" style={{ marginTop: "14px" }}>
              <button className="gd-cta" type="submit" disabled={authBusy}>
                {authBusy ? "Signing in…" : "Sign in"}
              </button>
              <button
                className="gd-pill"
                type="button"
                disabled={authBusy}
                onClick={() => auth(true)}
              >
                Create account
              </button>
              <button
                type="button"
                className="gd-button-subtle"
                onClick={async () => {
                  if (!login) {
                    notify("Enter your email first.");
                    return;
                  }
                  const { error } = await client.auth.resetPasswordForEmail(
                    login,
                    {
                      redirectTo:
                        location.origin + import.meta.env.BASE_URL + "#/data",
                    },
                  );
                  notify(error?.message ?? "Password reset email requested.");
                }}
              >
                Reset password
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </>
  );
}
