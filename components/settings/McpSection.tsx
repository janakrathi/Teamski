"use client";

import { useCallback, useEffect, useState } from "react";

import { cachedJson, peekJson } from "@/lib/net/cache";

import BrandIcon, { hasBrandIcon } from "@/components/ui/BrandIcon";


// ==========================================
// APPS
// ==========================================
//
// Notion, Linear, Jira and the rest, over MCP.
// Each card says what the app offers once it is
// connected, and which of those the agent may do
// on its own versus which ask first - the same
// promise the Google and GitHub cards make, told
// by the server rather than written here.
//

type Tool = {
  name: string;
  title: string;
  readOnly: boolean;
};

type Server = {
  id: string;
  catalogId: string | null;
  name: string;
  url: string;
  status: "pending" | "connected" | "error";
  error: string | null;
  enabled: boolean;
  tools: Tool[];
};

type Entry = {
  id: string;
  name: string;
  blurb: string;
};


export default function McpSection({
  projectId,
  onUpgrade,
}: {
  projectId: string | null;
  onUpgrade?: () => void;
}) {
  const mcpUrl = projectId
    ? `/api/mcp?projectId=${projectId}`
    : "/api/mcp";

  // Cached from a previous open, so the tab shows the
  // apps at once instead of loading them again.
  const known = peekJson<{
    catalog?: Entry[];
    servers?: Server[];
  }>(mcpUrl);

  const [catalog, setCatalog] = useState<Entry[]>(
    known?.catalog ?? []
  );
  const [servers, setServers] = useState<Server[]>(
    known?.servers ?? []
  );

  const [allowed, setAllowed] = useState(true);
  const [customAllowed, setCustomAllowed] = useState(false);
  const [requiredPlan, setRequiredPlan] = useState("Team");
  const [customPlan, setCustomPlan] = useState("Team");

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [expanded, setExpanded] = useState<string | null>(null);

  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({
    name: "",
    url: "",
    token: "",
  });


  // `force` re-reads past the cache, after a change.
  const load = useCallback(
    async (force = false) => {
      try {
        const data = (await cachedJson(mcpUrl, {
          force,
        })) as {
          error?: string;
          catalog?: Entry[];
          servers?: Server[];
          allowed?: boolean;
          customAllowed?: boolean;
          requiredPlan?: string;
          customPlan?: string;
          needsMigration?: boolean;
        };

        if (data.error) {
          throw new Error(data.error);
        }

        setCatalog(data.catalog ?? []);
        setServers(data.servers ?? []);
        setAllowed(data.allowed !== false);
        setCustomAllowed(Boolean(data.customAllowed));
        setRequiredPlan(data.requiredPlan ?? "Team");
        setCustomPlan(data.customPlan ?? "Team");

        if (data.needsMigration) {
          setError(
            "Run supabase/migrations/0021_mcp.sql to connect apps."
          );
        }
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not load apps."
        );
      }
    },
    [mcpUrl]
  );


  useEffect(() => {
    void Promise.resolve().then(() => load());

    // Coming back from signing in to an app.

    void Promise.resolve().then(() => {
      const params = new URLSearchParams(
        window.location.search
      );

      if (
        params.get("connected") === "error" &&
        params.get("reason")
      ) {
        setError(params.get("reason") ?? "");
      }

      // Read once. Left in the address, a reload
      // would reopen settings and repeat the
      // message.

      if (params.has("connected")) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname
        );
      }
    });
  }, [load]);


  async function send(
    key: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
    query = ""
  ) {
    setBusy(key);
    setError("");

    try {
      const response = await fetch(`/api/mcp${query}`, {
        method,
        headers: body
          ? { "Content-Type": "application/json" }
          : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();

      // Most apps want a sign-in, which happens on
      // their site and comes back here.

      if (data.authorizeUrl) {
        window.location.assign(data.authorizeUrl);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "That did not work.");
      }

      await load(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That did not work."
      );
    } finally {
      setBusy(null);
    }
  }


  const serverFor = (catalogId: string) =>
    servers.find((server) => server.catalogId === catalogId);

  const customServers = servers.filter(
    (server) => !server.catalogId
  );


  function renderCard({
    icon,
    title,
    blurb,
    server,
    onConnect,
  }: {
    // A catalog app's logo. Servers added by
    // address have none.
    icon?: string;
    title: string;
    blurb: string;
    server?: Server;
    onConnect: () => void;
  }) {
    const connected = server?.status === "connected";

    const readOnly =
      server?.tools.filter((tool) => tool.readOnly).length ?? 0;

    const asks = (server?.tools.length ?? 0) - readOnly;

    const open = expanded === server?.id;

    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]">
            {icon && hasBrandIcon(icon) ? (
              <BrandIcon id={icon} className="h-3.5 w-3.5" />
            ) : (
              <span className="text-[11px] font-medium">
                {title.trim().charAt(0).toUpperCase() || "?"}
              </span>
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] text-[var(--text)]">
              {title}
            </p>

            <p className="truncate text-[11px] text-[var(--text-faint)]">
              {connected
                ? `${server.tools.length} tools · ${readOnly} run on their own · ${asks} ask first`
                : server?.status === "error"
                  ? server.error
                  : blurb}
            </p>
          </div>

          {connected ? (
            <>
              {!server.enabled && (
                <span className="shrink-0 text-[10.5px] text-amber-300">
                  off
                </span>
              )}

              <button
                type="button"
                onClick={() =>
                  setExpanded(open ? null : server.id)
                }
                className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]"
              >
                {open ? "Hide" : "Details"}
              </button>
            </>
          ) : !allowed ? (
            <button
              type="button"
              onClick={onUpgrade}
              className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-faint)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-muted)]"
            >
              {requiredPlan}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={onConnect}
              className="shrink-0 rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
            >
              {busy === (server?.id ?? title)
                ? "Connecting…"
                : server?.status === "error"
                  ? "Retry"
                  : "Connect"}
            </button>
          )}
        </div>

        {open && server && (
          <div className="mt-2 border-t border-[var(--border)] pt-2">
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {server.tools.map((tool) => (
                <li
                  key={tool.name}
                  className="flex items-center gap-2 text-[11.5px]"
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--text-muted)]">
                    {tool.title}
                  </span>

                  <span
                    className={`shrink-0 text-[10px] ${
                      tool.readOnly
                        ? "text-emerald-400"
                        : "text-amber-300"
                    }`}
                  >
                    {tool.readOnly ? "reads" : "asks first"}
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
              The app says which tools only read.
              Anything it does not mark that way asks
              for your approval before it runs, and
              background agents never run those.
            </p>

            <div className="mt-2 flex gap-3">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  send(server.id, "PATCH", {
                    id: server.id,
                    action: "refresh",
                  })
                }
                className="text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-40"
              >
                Refresh
              </button>

              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  send(server.id, "PATCH", {
                    id: server.id,
                    action: server.enabled ? "disable" : "enable",
                  })
                }
                className="text-[11px] text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-40"
              >
                {server.enabled ? "Turn off" : "Turn on"}
              </button>

              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  send(
                    server.id,
                    "DELETE",
                    undefined,
                    `?id=${server.id}`
                  )
                }
                className="ml-auto text-[11px] text-[var(--text-faint)] transition hover:text-red-300 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }


  return (
    <div className="mt-6">
      <p className="mb-1 text-[10px] tracking-[0.12em] text-[var(--text-faint)] uppercase">
        Apps
      </p>

      <p className="mb-2 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        Connected over MCP. The agent acts as you
        in each app, and sees only what your
        account there can see.
      </p>

      {!allowed && (
        <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          Connecting apps is part of{" "}
          <span className="text-[var(--text)]">
            {requiredPlan}
          </span>
          .

          {onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              className="mt-2 block rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)] transition hover:opacity-90"
            >
              Upgrade to {requiredPlan}
            </button>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {catalog.map((entry) => (
          <div key={entry.id}>
            {renderCard({
              icon: entry.id,
              title: entry.name,
              blurb: entry.blurb,
              server: serverFor(entry.id),
              onConnect: () =>
                send(serverFor(entry.id)?.id ?? entry.name, "POST", {
                  catalogId: entry.id,
                  projectId,
                }),
            })}
          </div>
        ))}

        {customServers.map((server) => (
          <div key={server.id}>
            {renderCard({
              title: server.name,
              blurb: server.url,
              server,
              onConnect: () =>
                send(server.id, "POST", {
                  url: server.url,
                  name: server.name,
                  projectId,
                }),
            })}
          </div>
        ))}
      </div>


      {/* ANY SERVER BY ADDRESS */}

      {allowed && (
        <div className="mt-2">
          {!showCustom ? (
            <button
              type="button"
              onClick={() =>
                customAllowed
                  ? setShowCustom(true)
                  : onUpgrade?.()
              }
              className="w-full rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-[11.5px] text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              {customAllowed
                ? "Add an MCP server by address"
                : `Add any MCP server by address — ${customPlan}`}
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2.5">
              <input
                type="text"
                value={custom.name}
                placeholder="Name"
                onChange={(event) =>
                  setCustom({ ...custom, name: event.target.value })
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
              />

              <input
                type="text"
                value={custom.url}
                placeholder="https://example.com/mcp"
                onChange={(event) =>
                  setCustom({ ...custom, url: event.target.value })
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
              />

              <input
                type="password"
                autoComplete="off"
                value={custom.token}
                placeholder="Token, if it takes one instead of a sign-in"
                onChange={(event) =>
                  setCustom({ ...custom, token: event.target.value })
                }
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy !== null || !custom.url.trim()}
                  onClick={async () => {
                    await send("custom", "POST", {
                      ...custom,
                      projectId,
                    });

                    setCustom({ name: "", url: "", token: "" });
                    setShowCustom(false);
                  }}
                  className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"
                >
                  {busy === "custom" ? "Connecting…" : "Connect"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowCustom(false)}
                  className="text-[11px] text-[var(--text-faint)] transition hover:text-[var(--text-muted)]"
                >
                  Cancel
                </button>

                <span className="ml-auto text-[10.5px] text-[var(--text-faint)]">
                  Remote servers over https only
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-[12px] leading-relaxed text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
