import { useEffect, useRef, useState } from "react";
import {
  parseCodexTransportSettings,
  type AgentProviderPreference,
  type CodexTransport,
  type CodexTransportSettings,
} from "../../domain/agentProviderSettings";
import { SettingsButton } from "./primitives/SettingsButton";
import { SettingsSelect } from "./primitives/SettingsSelect";

export interface CodexTransportControlsProps {
  readonly preference: AgentProviderPreference;
  onSave(settings: CodexTransportSettings): Promise<boolean>;
}

export function CodexTransportControls({ preference, onSave }: CodexTransportControlsProps) {
  const initial = parseCodexTransportSettings(preference);
  const [transport, setTransport] = useState<CodexTransport>(initial.codexTransport);
  const [args, setArgs] = useState(initial.codexAppServerArgs.join("\n"));
  const [status, setStatus] = useState<"idle" | "saving" | "failed">("idle");
  const alive = useRef(false);
  const saving = useRef(false);
  const rejectedRollback = useRef<readonly string[] | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const persistedTransport = initial.codexTransport;
  const persistedArgs = initial.codexAppServerArgs.join("\n");
  useEffect(() => {
    if (saving.current) return;
    const canonical = JSON.stringify([persistedTransport, persistedArgs]);
    // A rejected save may publish its rollback in the same React batch as settlement.
    // Keep that attempted draft editable; reconcile genuinely different external settings.
    if (rejectedRollback.current?.includes(canonical)) return;
    rejectedRollback.current = null;
    setTransport(persistedTransport);
    setArgs(persistedArgs);
    setStatus("idle");
  }, [persistedTransport, persistedArgs, status]);
  let settings: ReturnType<typeof parseCodexTransportSettings> | null = null;
  try {
    settings = parseCodexTransportSettings({
      codexTransport: transport,
      codexAppServerArgs: args === "" ? [] : args.split("\n"),
    });
  } catch {
    /* The domain parser owns argument validation. */
  }
  const invalid = settings === null;
  const disabled = !preference.enabled || status === "saving";
  const changed =
    transport !== initial.codexTransport || args !== initial.codexAppServerArgs.join("\n");
  const save = async (): Promise<void> => {
    if (disabled || saving.current || settings === null || !changed) return;
    const beforeSave = JSON.stringify([persistedTransport, persistedArgs]);
    rejectedRollback.current = null;
    saving.current = true;
    setStatus("saving");
    let succeeded = false;
    try {
      succeeded = await onSave(settings);
    } catch {
      /* Show a bounded save failure. */
    }
    if (!alive.current) return;
    if (!succeeded)
      rejectedRollback.current = [
        beforeSave,
        JSON.stringify([settings.codexTransport, settings.codexAppServerArgs.join("\n")]),
      ];
    saving.current = false;
    setStatus(succeeded ? "idle" : "failed");
  };
  return (
    <div>
      <div className="settings-provider__field">
        <span className="settings-provider__field-label">Codex connection</span>
        <SettingsSelect
          label="Codex connection"
          disabled={disabled}
          value={transport}
          options={[
            { value: "appServer", label: "App server (default)" },
            { value: "exec", label: "CLI exec (legacy)" },
          ]}
          onChange={(value) => {
            if (value === "appServer" || value === "exec") setTransport(value);
          }}
        />
      </div>
      <label className="settings-provider__field">
        <span className="settings-provider__field-label">App server arguments</span>
        <textarea
          className="settings-input"
          data-width="full"
          data-mono="true"
          aria-describedby="codex-arguments-hint"
          aria-invalid={invalid || undefined}
          disabled={disabled || transport === "exec"}
          maxLength={4111}
          rows={3}
          spellCheck={false}
          value={args}
          onChange={(event) => setArgs(event.currentTarget.value)}
        />
        <small className="settings-provider__hint" id="codex-arguments-hint">
          {invalid
            ? "Use at most 16 nonempty arguments, one per line, with up to 256 printable ASCII characters each. Routing arguments are not allowed."
            : "Optional, one argument per line. Used only with App server."}
        </small>
      </label>
      <SettingsButton
        disabled={disabled || invalid || !changed}
        onClick={() => void save()}
        size="compact"
        variant="outline"
      >
        {status === "saving" ? "Saving…" : "Save Codex connection"}
      </SettingsButton>
      {status === "failed" ? (
        <p role="alert" className="settings-provider__status settings-provider__status--danger">
          Could not save Codex connection settings. Try again.
        </p>
      ) : null}
    </div>
  );
}
