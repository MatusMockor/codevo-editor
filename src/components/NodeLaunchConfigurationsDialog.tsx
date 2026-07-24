import { Plus, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  deleteNodeLaunchConfiguration,
  upsertNodeLaunchConfiguration,
  type NodeLaunchConfiguration,
  type NodeLaunchConfigurationTarget,
} from "../domain/nodeLaunchConfiguration";
import { isNodeDebugPort, MAX_NODE_DEBUG_PORT, MIN_NODE_DEBUG_PORT } from "../domain/debug";

interface NodeLaunchConfigurationDraft {
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly default: boolean;
  readonly env: Readonly<Record<string, string>>;
  readonly name: string;
  readonly target: NodeLaunchConfigurationTarget;
}

export interface NodeLaunchConfigurationsDialogProps {
  readonly configurations: readonly NodeLaunchConfiguration[];
  readonly error: string | null;
  readonly isOpen: boolean;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSave: (configurations: readonly NodeLaunchConfiguration[]) => Promise<boolean>;
  readonly saving: boolean;
  readonly workspaceTrusted: boolean;
}

const styles: Record<string, CSSProperties> = {
  actions: { display: "flex", gap: 8, justifyContent: "flex-end" },
  backdrop: {
    alignItems: "center",
    background: "rgba(0, 0, 0, 0.45)",
    display: "flex",
    inset: 0,
    justifyContent: "center",
    position: "fixed",
    zIndex: 1000,
  },
  dialog: {
    background: "var(--panel-background)",
    border: "1px solid var(--border-subtle)",
    color: "var(--text-primary)",
    display: "grid",
    gap: 12,
    maxHeight: "85vh",
    maxWidth: 900,
    overflow: "auto",
    padding: 16,
    width: "min(900px, 92vw)",
  },
  field: { display: "grid", gap: 4 },
  form: { display: "grid", gap: 10 },
  grid: { display: "grid", gap: 16, gridTemplateColumns: "220px minmax(0, 1fr)" },
  header: { alignItems: "center", display: "flex", justifyContent: "space-between" },
  message: { color: "var(--text-muted)" },
  toolbar: { display: "flex", gap: 6 },
};

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function NodeLaunchConfigurationsDialog({
  configurations,
  error,
  isOpen,
  loading,
  onClose,
  onSave,
  saving,
  workspaceTrusted,
}: NodeLaunchConfigurationsDialogProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [originalName, setOriginalName] = useState<string | null>(null);
  const [draft, setDraft] = useState<NodeLaunchConfigurationDraft>(() => newConfiguration());
  const [argsText, setArgsText] = useState("");
  const [attachPortText, setAttachPortText] = useState("9229");
  const [envText, setEnvText] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const wasOpenRef = useRef(false);
  const wasLoadingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const selected = useMemo(
    () => configurations.find((configuration) => configuration.name === selectedName) ?? null,
    [configurations, selectedName],
  );
  const loadDraft = useCallback(
    (configuration: NodeLaunchConfiguration, persistedName: string | null) => {
      setSelectedName(persistedName);
      setOriginalName(persistedName);
      setDraft({
        ...configuration,
        args: configuration.target.kind === "attach" ? [] : configuration.args,
        env: configuration.target.kind === "attach" ? {} : configuration.env,
      });
      setArgsText(configuration.target.kind === "attach" ? "" : configuration.args.join("\n"));
      setAttachPortText(
        configuration.target.kind === "attach" ? String(configuration.target.port) : "9229",
      );
      setEnvText(
        Object.entries(configuration.target.kind === "attach" ? {} : configuration.env)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      );
      setValidationError(null);
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      wasLoadingRef.current = false;
      return;
    }
    if (!wasOpenRef.current || (wasLoadingRef.current && !loading)) {
      const next = configurations[0] ?? newConfiguration();
      loadDraft(next, configurations.length > 0 ? next.name : null);
    }
    wasOpenRef.current = true;
    wasLoadingRef.current = loading;
  }, [configurations, isOpen, loadDraft, loading]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const busy = loading || saving;

  const persist = async (next: readonly NodeLaunchConfiguration[]): Promise<boolean> => {
    try {
      return await onSave(next);
    } catch (saveError) {
      setValidationError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    }
  };

  const save = async () => {
    if (draft.target.kind === "attach") {
      const port = nodeDebugPortFromText(attachPortText);
      const configuration =
        port === null
          ? null
          : configurationFromDraft({ ...draft, target: { kind: "attach", port } }, [], {});
      if (!configuration) {
        setValidationError("Attach port must be an integer between 1 and 65535.");
        return;
      }
      await saveConfiguration(configuration);
      return;
    }
    const environment = environmentFromText(envText);
    if (environment.kind === "error") {
      setValidationError(environment.message);
      return;
    }
    const configuration = configurationFromDraft(draft, lines(argsText), environment.value);
    if (!configuration) return;
    await saveConfiguration(configuration);
  };

  const saveConfiguration = async (configuration: NodeLaunchConfiguration) => {
    const result = upsertNodeLaunchConfiguration(configurations, originalName, configuration);
    if (result.kind === "error") {
      setValidationError(result.message);
      return;
    }
    setValidationError(null);
    if (await persist(result.configurations)) {
      const saved = result.configurations.find(
        (configuration) => configuration.name === draft.name,
      );
      if (saved) loadDraft(saved, saved.name);
    }
  };

  return (
    <div style={styles.backdrop} onMouseDown={onClose} role="presentation">
      <section
        aria-busy={busy}
        aria-label="Node launch configurations"
        aria-modal="true"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        style={styles.dialog}
      >
        <header style={styles.header}>
          <h2>Node launch configurations</h2>
          <button aria-label="Close Node launch configurations" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        {!workspaceTrusted ? (
          <div role="status" style={styles.message}>
            Trust this workspace to save launch configurations.
          </div>
        ) : null}
        {loading ? <div role="status">Loading launch configurations…</div> : null}
        {error ? <div role="alert">{error}</div> : null}
        {validationError ? <div role="alert">{validationError}</div> : null}

        <div style={styles.grid}>
          <div style={styles.form}>
            <div style={styles.toolbar}>
              <button
                disabled={busy}
                onClick={() => loadDraft(newConfiguration(), null)}
                type="button"
              >
                <Plus aria-hidden="true" size={14} /> New
              </button>
              <button
                disabled={busy || !selected || !workspaceTrusted}
                onClick={() => {
                  if (selected) {
                    const next = deleteNodeLaunchConfiguration(configurations, selected.name);
                    void persist(next).then((saved) => {
                      if (saved) loadDraft(next[0] ?? newConfiguration(), next[0]?.name ?? null);
                    });
                  }
                }}
                type="button"
              >
                <Trash2 aria-hidden="true" size={14} /> Delete
              </button>
            </div>
            <label style={styles.field}>
              Configurations
              <select
                aria-label="Node launch configurations"
                disabled={busy}
                onChange={(event) => {
                  const configuration = configurations.find(
                    (candidate) => candidate.name === event.currentTarget.value,
                  );
                  if (configuration) loadDraft(configuration, configuration.name);
                }}
                size={Math.max(3, Math.min(configurations.length, 10))}
                value={selectedName ?? ""}
              >
                {configurations.map((configuration) => (
                  <option key={configuration.name} value={configuration.name}>
                    {configuration.default ? "★ " : ""}
                    {configuration.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={styles.form}>
            <label style={styles.field}>
              Name
              <input
                aria-label="Configuration name"
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                value={draft.name}
              />
            </label>
            <label style={styles.field}>
              Target type
              <select
                aria-label="Target type"
                disabled={busy}
                onChange={(event) => {
                  const target = targetForKind(event.currentTarget.value);
                  setDraft({ ...draft, target });
                  if (target.kind === "attach") setAttachPortText(String(target.port));
                }}
                value={draft.target.kind}
              >
                <option value="script">Script</option>
                <option value="test">Test</option>
                <option value="npm">npm script</option>
                <option value="attach">Attach</option>
              </select>
            </label>
            <TargetFields
              attachPortText={attachPortText}
              busy={busy}
              draft={draft}
              setAttachPortText={setAttachPortText}
              setDraft={setDraft}
            />
            {draft.target.kind !== "attach" ? (
              <>
                <label style={styles.field}>
                  Working directory (workspace-relative)
                  <input
                    aria-label="Working directory"
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, cwd: event.currentTarget.value || undefined })
                    }
                    value={draft.cwd ?? ""}
                  />
                </label>
                <label style={styles.field}>
                  Arguments (one per line)
                  <textarea
                    aria-label="Arguments"
                    disabled={busy}
                    onChange={(event) => setArgsText(event.currentTarget.value)}
                    rows={4}
                    value={argsText}
                  />
                </label>
                <label style={styles.field}>
                  Environment (KEY=value, one per line)
                  <textarea
                    aria-label="Environment"
                    disabled={busy}
                    onChange={(event) => setEnvText(event.currentTarget.value)}
                    rows={4}
                    value={envText}
                  />
                  <small style={styles.message}>
                    Stored as plaintext in the workspace. Do not put secrets in launch.json.
                  </small>
                </label>
              </>
            ) : null}
            <label>
              <input
                checked={draft.default}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, default: event.currentTarget.checked })}
                type="checkbox"
              />{" "}
              Default configuration
            </label>
          </div>
        </div>

        <div style={styles.actions}>
          <button onClick={onClose} type="button">
            Cancel
          </button>
          <button disabled={busy || !workspaceTrusted} onClick={() => void save()} type="button">
            {saving ? "Saving…" : "Save configuration"}
          </button>
        </div>
      </section>
    </div>
  );
}

function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }
  if (event.key !== "Tab") return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute("disabled"));
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function TargetFields({
  attachPortText,
  busy,
  draft,
  setAttachPortText,
  setDraft,
}: {
  readonly attachPortText: string;
  readonly busy: boolean;
  readonly draft: NodeLaunchConfigurationDraft;
  readonly setAttachPortText: (value: string) => void;
  readonly setDraft: (draft: NodeLaunchConfigurationDraft) => void;
}) {
  const updateTarget = (target: NodeLaunchConfigurationTarget) => setDraft({ ...draft, target });
  if (draft.target.kind === "attach") {
    const invalid = nodeDebugPortFromText(attachPortText) === null;
    return (
      <label style={styles.field}>
        Inspector port
        <input
          aria-describedby={invalid ? "node-attach-port-error" : undefined}
          aria-invalid={invalid}
          aria-label="Inspector port"
          disabled={busy}
          max={MAX_NODE_DEBUG_PORT}
          min={MIN_NODE_DEBUG_PORT}
          onChange={(event) => setAttachPortText(event.currentTarget.value)}
          type="number"
          value={attachPortText}
        />
        {invalid ? (
          <small id="node-attach-port-error" role="alert">
            Port must be an integer between 1 and 65535.
          </small>
        ) : null}
      </label>
    );
  }
  if (draft.target.kind === "script") {
    const target = draft.target;
    return (
      <TextField
        label="Script path"
        value={target.path}
        disabled={busy}
        onChange={(path) => updateTarget({ kind: "script", path })}
      />
    );
  }
  if (draft.target.kind === "npm") {
    const target = draft.target;
    return (
      <>
        <TextField
          label="npm script"
          value={target.script}
          disabled={busy}
          onChange={(script) => updateTarget({ ...target, script })}
        />
        <TextField
          label="Package root"
          value={target.packageRoot ?? ""}
          disabled={busy}
          onChange={(packageRoot) =>
            updateTarget({ ...target, packageRoot: packageRoot || undefined })
          }
        />
      </>
    );
  }
  const target = draft.target;
  return (
    <>
      <TextField
        label="Test path"
        value={target.path}
        disabled={busy}
        onChange={(path) => updateTarget({ ...target, path })}
      />
      <label style={styles.field}>
        Test runner
        <select
          aria-label="Test runner"
          disabled={busy}
          onChange={(event) =>
            updateTarget({
              ...target,
              runner: event.currentTarget.value as "jest" | "vitest",
            })
          }
          value={target.runner}
        >
          <option value="vitest">Vitest</option>
          <option value="jest">Jest</option>
        </select>
      </label>
      <TextField
        label="Package root"
        value={target.packageRoot ?? ""}
        disabled={busy}
        onChange={(packageRoot) =>
          updateTarget({ ...target, packageRoot: packageRoot || undefined })
        }
      />
    </>
  );
}

function nodeDebugPortFromText(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const port = Number(normalized);
  return isNodeDebugPort(port) ? port : null;
}

function TextField({
  disabled,
  label,
  onChange,
  value,
}: {
  readonly disabled: boolean;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  return (
    <label style={styles.field}>
      {label}
      <input
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </label>
  );
}

function newConfiguration(): NodeLaunchConfigurationDraft {
  return {
    args: [],
    default: false,
    env: {},
    name: "New configuration",
    target: { kind: "script", path: "" },
  };
}

function targetForKind(kind: string): NodeLaunchConfigurationTarget {
  if (kind === "attach") return { kind: "attach", port: 9229 };
  if (kind === "npm") return { kind: "npm", script: "" };
  if (kind === "test") return { kind: "test", path: "", runner: "vitest" };
  return { kind: "script", path: "" };
}

function configurationFromDraft(
  draft: NodeLaunchConfigurationDraft,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): NodeLaunchConfiguration | null {
  if (draft.target.kind === "attach") {
    return isNodeDebugPort(draft.target.port)
      ? { args: [], default: draft.default, env: {}, name: draft.name, target: draft.target }
      : null;
  }
  return { ...draft, args, env };
}

function lines(value: string): string[] {
  return value ? value.split(/\r?\n/) : [];
}

function environmentFromText(
  value: string,
):
  | { readonly kind: "ok"; readonly value: Record<string, string> }
  | { readonly kind: "error"; readonly message: string } {
  const environment: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf("=");
    const key = separator < 0 ? "" : line.slice(0, separator);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return { kind: "error", message: "Environment entries must use KEY=value." };
    }
    environment[key] = line.slice(separator + 1);
  }
  return { kind: "ok", value: environment };
}
