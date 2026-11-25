import { useState } from "react";

import type { AppState, ProviderInfo } from "../shared/types.ts";
import { api } from "./api.ts";

// ==========================================
// SETTINGS
// ==========================================
//
// Keys are pasted here and go straight to the main
// process, which seals them in the OS keychain. The
// page never sees a saved key again - only whether
// there is one.
//

function ProviderCard({ provider, onState }: { provider: ProviderInfo; onState: (state: AppState) => void }) {
  const [key, setKey] = useState("");
  const [url, setUrl] = useState(provider.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);

  const check = async () => {
    const result = await api().listModels(provider.id);
    setMessage(
      result.error
        ? { text: result.error, good: false }
        : { text: `Connected - ${result.models.length} models available.`, good: true }
    );
  };

  const saveKey = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      onState(await api().setKey(provider.id, key.trim()));
      setKey("");
      await check();
    } catch (error) {
      setMessage({ text: (error as Error).message, good: false });
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async () => {
    onState(await api().setKey(provider.id, null));
    setMessage(null);
  };

  const saveUrl = async () => {
    setBusy(true);
    setMessage(null);
    try {
      onState(await api().setBaseUrl(provider.id, url.trim()));
      await check();
    } catch (error) {
      setMessage({ text: (error as Error).message, good: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="provider">
      <div className="line">
        <span className="name">{provider.label}</span>
        {provider.free && <span className="badge free">free</span>}
        {provider.hasKey && <span className="badge on">key saved</span>}
        <span style={{ flex: 1 }} />
        {provider.keyUrl && (
          <button className="link" onClick={() => void api().openExternal(provider.keyUrl!)}>
            {provider.needsKey ? "Get a key ↗" : "Download ↗"}
          </button>
        )}
      </div>
      {provider.note && <div className="note">{provider.note}</div>}

      {provider.editableUrl && (
        <div className="edit">
          <input
            className="field"
            placeholder={provider.id === "ollama" ? "http://127.0.0.1:11434" : "https://your-server/v1"}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button className="btn" disabled={busy} onClick={() => void saveUrl()}>
            {provider.id === "ollama" ? "Save & check" : "Save"}
          </button>
        </div>
      )}

      {(provider.needsKey || provider.id === "custom") && (
        <div className="edit">
          <input
            className="field"
            type="password"
            placeholder={provider.hasKey ? "Paste a new key to replace the saved one" : provider.needsKey ? "Paste your API key" : "API key (optional)"}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveKey();
            }}
          />
          <button className="btn primary" disabled={busy || !key.trim()} onClick={() => void saveKey()}>
            Save
          </button>
          {provider.hasKey && (
            <button className="btn danger" onClick={() => void removeKey()}>
              Remove
            </button>
          )}
        </div>
      )}

      {message && <div className={`msg ${message.good ? "good" : "bad"}`}>{message.text}</div>}
    </div>
  );
}

export function Settings({
  state,
  onState,
  onClose,
}: {
  state: AppState;
  onState: (state: AppState) => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="Settings">
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{ flex: 1 }}>
            <h2>Settings</h2>
            <p className="lead">
              Teamski Code runs on your own keys or your own computer. Keys are stored encrypted in this computer's
              keychain and only ever sent to the provider they belong to.
            </p>
          </div>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <h3>Agent</h3>
        <div className="toggle-row">
          <div>
            Show the model's thinking
            <div className="sub">For models that stream their reasoning.</div>
          </div>
          <div className="seg">
            <button
              className={state.settings.showThinking ? "on" : ""}
              onClick={async () => onState(await api().setSettings({ showThinking: true }))}
            >
              Show
            </button>
            <button
              className={!state.settings.showThinking ? "on" : ""}
              onClick={async () => onState(await api().setSettings({ showThinking: false }))}
            >
              Hide
            </button>
          </div>
        </div>

        <h3>Models</h3>
        {state.providers.map((provider) => (
          <ProviderCard key={provider.id} provider={provider} onState={onState} />
        ))}

        <p className="lead" style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}>
          Teamski {state.version} · Your team's workspace is in the Workspace tab, signed in to {new URL(state.workspaceUrl).host}.
        </p>
      </div>
    </div>
  );
}
