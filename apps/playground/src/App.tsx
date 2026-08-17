import { A2UIRenderer } from "@valuz-genui/a2ui/react";
import { A2UIGallery } from "@valuz-genui/a2ui/gallery";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchCatalog,
  fetchHealth,
  streamGenerate,
  type CatalogComponent,
  type GenerateResultPayload,
  type HealthInfo,
} from "./api";
import { EXAMPLES } from "./examples";

type View = "generate" | "gallery";
type OutputTab = "preview" | "jsonl" | "log";
type Theme = "light" | "dark";
type RunStatus = "idle" | "running" | "success" | "error";

interface LogLine {
  at: number;
  text: string;
}

function formatLog(status: Record<string, unknown> & { type: string }): string {
  switch (status.type) {
    case "attempt":
      return `attempt ${status.attempt}/${status.maxAttempts}`;
    case "turn":
      return `turn ${Number(status.continuation) + 1}: finish=${status.finishReason} chars=${status.chars}${status.truncated ? " (truncated)" : ""}`;
    case "continuation":
      return `continuation ${status.continuation}/${status.maxContinuations}`;
    case "fallback":
      return `fallback: ${status.reason}`;
    case "retry":
      return `retry after attempt ${status.attempt}: ${status.reason}`;
    default:
      return JSON.stringify(status);
  }
}

interface ThinkingPanelProps {
  text: string;
  open: boolean;
  /** True while the model is still thinking and no document has started. */
  running: boolean;
  onToggle: () => void;
}

function ThinkingPanel({ text, open, running, onToggle }: ThinkingPanelProps) {
  const bodyRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (!open || !running) return;
    const element = bodyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [text, open, running]);
  return (
    <section className={`pg-thinking${running ? " is-running" : ""}`} data-slot="thinking">
      <button className="pg-thinking__header" onClick={onToggle} type="button" aria-expanded={open}>
        <span className="pg-thinking__caret">{open ? "▾" : "▸"}</span>
        <span className="pg-thinking__title">{running ? "Thinking…" : "Thinking"}</span>
        <span className="pg-thinking__meta">{text.length.toLocaleString()} chars</span>
      </button>
      {open ? (
        <pre ref={bodyRef} className="pg-thinking__body">
          {text}
        </pre>
      ) : null}
    </section>
  );
}

export function App() {
  const [view, setView] = useState<View>("generate");
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  );
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogComponent[]>([]);

  const [request, setRequest] = useState(EXAMPLES[0]?.request ?? "");
  const [dataText, setDataText] = useState(EXAMPLES[0]?.data ? JSON.stringify(EXAMPLES[0].data, null, 2) : "");
  const [componentNamesText, setComponentNamesText] = useState("");
  const [editCurrent, setEditCurrent] = useState(false);

  const [status, setStatus] = useState<RunStatus>("idle");
  const [raw, setRaw] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [result, setResult] = useState<GenerateResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [outputTab, setOutputTab] = useState<OutputTab>("preview");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    fetchHealth()
      .then((info) => {
        setHealth(info);
        setHealthError(null);
      })
      .catch((cause: unknown) => setHealthError(cause instanceof Error ? cause.message : String(cause)));
    fetchCatalog()
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, []);

  const dataError = useMemo(() => {
    if (!dataText.trim()) return null;
    try {
      JSON.parse(dataText);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "invalid JSON";
    }
  }, [dataText]);

  const appendLog = useCallback((text: string) => {
    setLog((previous) => [...previous, { at: Date.now(), text }]);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const run = useCallback(async () => {
    if (!request.trim() || dataError) return;
    stop();
    const controller = new AbortController();
    abortRef.current = controller;
    const previousDocument = editCurrent ? result?.document ?? null : null;
    setStatus("running");
    setRaw("");
    setReasoning("");
    setThinkingOpen(true);
    setResult(null);
    setError(null);
    setLog([]);
    setOutputTab("preview");
    appendLog("request sent");
    let failed = false;
    try {
      const componentNames = componentNamesText
        .split(/[,\s]+/)
        .map((name) => name.trim())
        .filter(Boolean);
      for await (const event of streamGenerate(
        {
          request,
          data: dataText.trim() ? JSON.parse(dataText) : undefined,
          currentDocument: previousDocument,
          componentNames: componentNames.length ? componentNames : null,
        },
        controller.signal,
      )) {
        if (event.event === "start") appendLog(`model: ${event.data.model}`);
        else if (event.event === "delta") setRaw((previous) => previous + event.data.text);
        else if (event.event === "reasoning") setReasoning((previous) => previous + event.data.text);
        else if (event.event === "status") appendLog(formatLog(event.data));
        else if (event.event === "result") {
          setResult(event.data);
          setRaw(event.data.raw);
          setReasoning(event.data.reasoning);
          // Thinking is context, not the deliverable: collapse it once the page is on screen.
          setThinkingOpen(false);
          appendLog(
            `done in ${event.data.elapsedMs} ms · ${event.data.componentNames.length} component types · ` +
              `${event.data.usage.inputTokens} in / ${event.data.usage.outputTokens} out tokens` +
              (event.data.reasoning ? ` · ${event.data.reasoning.length} chars of reasoning` : "") +
              (event.data.warnings.length ? ` · ${event.data.warnings.length} warning(s)` : ""),
          );
          for (const warning of event.data.warnings) {
            appendLog(`warning: ${warning.component}#${warning.id}: ${warning.reason}`);
          }
        } else if (event.event === "error") {
          failed = true;
          setError(event.data.message);
          appendLog(`error: ${event.data.message}`);
        }
      }
      setStatus(failed ? "error" : "success");
    } catch (cause) {
      if (controller.signal.aborted) {
        appendLog("stopped");
        setStatus("idle");
      } else {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setStatus("error");
        appendLog(`error: ${message}`);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [appendLog, componentNamesText, dataError, dataText, editCurrent, request, result?.document, stop]);

  const loadExample = (id: string) => {
    const example = EXAMPLES.find((entry) => entry.id === id);
    if (!example) return;
    setRequest(example.request);
    setDataText(example.data ? JSON.stringify(example.data, null, 2) : "");
    setComponentNamesText(example.componentNames?.join(", ") ?? "");
  };

  const previewBody = result?.document ?? raw;
  const previewStatus = status === "running" ? "running" : "success";

  return (
    <div className="pg-app">
      <header className="pg-header">
        <div className="pg-brand">
          <span className="pg-logo">valuz-genui</span>
          <span className="pg-subtitle">prompt → A2UI v0.9.1 → UI</span>
        </div>
        <nav className="pg-nav">
          <button className={view === "generate" ? "is-active" : ""} onClick={() => setView("generate")} type="button">
            Generate
          </button>
          <button className={view === "gallery" ? "is-active" : ""} onClick={() => setView("gallery")} type="button">
            Gallery
          </button>
        </nav>
        <div className="pg-status">
          {health ? (
            <span className="pg-pill pg-pill--ok" title={health.catalog.id}>
              {health.model} · {health.catalog.count} components
              {health.reasoningEffort && health.reasoningEffort !== "provider-default"
                ? ` · reasoning ${health.reasoningEffort}`
                : ""}
            </span>
          ) : (
            <span className="pg-pill pg-pill--warn" title={healthError ?? ""}>
              server unreachable{healthError ? `: ${healthError}` : ""}
            </span>
          )}
          <button className="pg-theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} type="button">
            {theme === "light" ? "☾ dark" : "☀ light"}
          </button>
        </div>
      </header>

      {view === "gallery" ? (
        <main className="pg-gallery">
          <A2UIGallery embedded />
        </main>
      ) : (
        <main className="pg-main">
          <section className="pg-panel pg-panel--input">
            <label className="pg-field">
              <span className="pg-label">
                Example
                <select className="pg-select" defaultValue="" onChange={(e) => loadExample(e.target.value)}>
                  <option value="" disabled>
                    Load an example…
                  </option>
                  {EXAMPLES.map((example) => (
                    <option key={example.id} value={example.id}>
                      {example.title}
                    </option>
                  ))}
                </select>
              </span>
            </label>

            <label className="pg-field">
              <span className="pg-label">Request</span>
              <textarea
                className="pg-textarea pg-textarea--request"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="Describe the UI you want…"
              />
            </label>

            <label className="pg-field">
              <span className="pg-label">
                Data (JSON, optional)
                {dataError ? <span className="pg-error-inline"> · {dataError}</span> : null}
              </span>
              <textarea
                className={`pg-textarea pg-textarea--data${dataError ? " is-invalid" : ""}`}
                value={dataText}
                onChange={(e) => setDataText(e.target.value)}
                placeholder='{"kpis": [...]}'
                spellCheck={false}
              />
            </label>

            <label className="pg-field">
              <span className="pg-label">Component names (optional, comma-separated)</span>
              <input
                className="pg-input"
                list="pg-catalog"
                value={componentNamesText}
                onChange={(e) => setComponentNamesText(e.target.value)}
                placeholder="MetricGroup, BarChart, Callout"
              />
              <datalist id="pg-catalog">
                {catalog.map((component) => (
                  <option key={component.name} value={component.name}>
                    {component.description}
                  </option>
                ))}
              </datalist>
            </label>

            <label className="pg-check">
              <input
                type="checkbox"
                checked={editCurrent}
                disabled={!result}
                onChange={(e) => setEditCurrent(e.target.checked)}
              />
              <span>Edit the current document (send it back as context)</span>
            </label>

            <div className="pg-actions">
              <button
                className="pg-button pg-button--primary"
                disabled={status === "running" || !request.trim() || Boolean(dataError)}
                onClick={() => void run()}
                type="button"
              >
                {status === "running" ? "Generating…" : "Generate"}
              </button>
              <button className="pg-button" disabled={status !== "running"} onClick={stop} type="button">
                Stop
              </button>
            </div>
          </section>

          <section className="pg-panel pg-panel--output">
            <div className="pg-tabs">
              {(["preview", "jsonl", "log"] as OutputTab[]).map((tab) => (
                <button
                  key={tab}
                  className={outputTab === tab ? "is-active" : ""}
                  onClick={() => setOutputTab(tab)}
                  type="button"
                >
                  {tab === "preview" ? "Preview" : tab === "jsonl" ? "JSONL" : `Log${log.length ? ` (${log.length})` : ""}`}
                </button>
              ))}
              <span className={`pg-run-status pg-run-status--${status}`}>{status}</span>
            </div>

            {outputTab === "preview" ? (
              <div className="pg-preview" data-theme={theme}>
                {reasoning ? (
                  <ThinkingPanel
                    text={reasoning}
                    open={thinkingOpen}
                    running={status === "running" && !previewBody}
                    onToggle={() => setThinkingOpen((previous) => !previous)}
                  />
                ) : null}
                {error && !previewBody ? <div className="pg-error">{error}</div> : null}
                {previewBody || status === "running" ? (
                  <A2UIRenderer body={previewBody} status={previewStatus} theme={theme} debug={import.meta.env.DEV} />
                ) : (
                  <div className="pg-empty">Generate something to see it rendered here.</div>
                )}
                {error && previewBody ? <div className="pg-error pg-error--footer">{error}</div> : null}
              </div>
            ) : null}

            {outputTab === "jsonl" ? (
              <pre className="pg-code">{result?.document ?? raw ?? ""}</pre>
            ) : null}

            {outputTab === "log" ? (
              <div className="pg-log">
                {log.length ? (
                  log.map((line, index) => (
                    <div key={`${line.at}-${index}`} className="pg-log__line">
                      <span className="pg-log__time">{new Date(line.at).toLocaleTimeString()}</span>
                      <span>{line.text}</span>
                    </div>
                  ))
                ) : (
                  <div className="pg-empty">No events yet.</div>
                )}
                {result ? (
                  <details className="pg-details">
                    <summary>Prompt sent to the model ({result.prompt.length.toLocaleString()} chars)</summary>
                    <pre className="pg-code pg-code--inline">{result.prompt}</pre>
                  </details>
                ) : null}
              </div>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}
