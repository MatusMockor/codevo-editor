import { Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type {
  NodeDebugLaunchChoice,
  NodeDebugLaunchSelectorState,
} from "./NodeDebugLaunchSelector";

export type NodeLaunchConfigurationPickerChoice = NodeDebugLaunchChoice & {
  readonly preLaunchTask?: string;
  readonly runnable?: boolean;
  readonly source?: "codevo" | "vscode";
};
export type NodeLaunchConfigurationPickerState = NodeDebugLaunchSelectorState;

export const MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS = 64;

export interface NodeLaunchConfigurationPickerDiagnosticNotice {
  readonly count: number;
  readonly message: string;
}

const ENABLED_FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type NodeLaunchConfigurationPickerIntent = "debug" | "run";

export interface NodeLaunchConfigurationPickerProps {
  readonly busy: boolean;
  readonly choices: readonly NodeLaunchConfigurationPickerChoice[];
  readonly diagnosticNotice?: NodeLaunchConfigurationPickerDiagnosticNotice;
  readonly error: string | null;
  readonly intent: NodeLaunchConfigurationPickerIntent;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  readonly onStartNamed: (name: string) => void;
  readonly open: boolean;
  readonly selectedName: string | null;
  readonly state: NodeLaunchConfigurationPickerState;
}

const styles: Record<string, CSSProperties> = {
  backdrop: {
    alignItems: "flex-start",
    background: "rgba(0, 0, 0, 0.38)",
    display: "flex",
    inset: 0,
    justifyContent: "center",
    paddingTop: "12vh",
    position: "fixed",
    zIndex: 100,
  },
  close: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    padding: 3,
  },
  dialog: {
    background: "var(--background-primary, #1e1e1e)",
    border: "1px solid var(--border-subtle)",
    borderRadius: 6,
    boxShadow: "0 12px 36px rgba(0, 0, 0, 0.45)",
    color: "inherit",
    display: "grid",
    gap: 6,
    maxHeight: "70vh",
    maxWidth: 620,
    minWidth: 360,
    overflow: "hidden",
    padding: 8,
    width: "55vw",
  },
  header: { alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" },
  inputWrapper: { alignItems: "center", display: "flex", gap: 6 },
  input: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    flex: 1,
    minWidth: 0,
    padding: "6px 8px",
  },
  list: { margin: 0, maxHeight: "50vh", overflow: "auto", padding: 0 },
  message: { color: "var(--text-muted)", padding: "12px 8px" },
  option: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
    padding: "7px 8px",
    textAlign: "left",
    width: "100%",
  },
  optionActive: { background: "var(--background-active, rgba(127, 127, 127, 0.2))" },
  target: { color: "var(--text-muted)", fontSize: 11 },
  optionDetails: {
    alignItems: "flex-end",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  source: { color: "var(--text-muted)", fontSize: 11 },
};

export function NodeLaunchConfigurationPicker({
  busy,
  choices,
  diagnosticNotice,
  error,
  intent,
  onClose,
  onRefresh,
  onStartNamed,
  open,
  selectedName,
  state,
}: NodeLaunchConfigurationPickerProps) {
  const copy = pickerCopy(intent);
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  const [query, setQuery] = useState("");
  const choiceIdentity = choices
    .slice(0, MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS)
    .map(
      ({
        compoundMemberCount,
        default: isDefault,
        hasPreLaunchTask,
        name,
        preLaunchTask,
        runnable,
        source,
        targetKind,
      }) =>
        JSON.stringify([
          compoundMemberCount,
          isDefault,
          hasPreLaunchTask,
          name,
          preLaunchTask,
          runnable,
          source,
          targetKind,
        ]),
    )
    .join("\0");
  const visibleChoices = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return choices
      .filter(
        ({ compoundMemberCount, hasPreLaunchTask, name, preLaunchTask, source, targetKind }) =>
          normalizedQuery
            ? `${name} ${targetKind} ${source ?? ""} ${preLaunchTask ?? ""} ${compoundMemberCount ?? ""} ${hasPreLaunchTask ? "preLaunchTask" : ""}`
                .toLocaleLowerCase()
                .includes(normalizedQuery)
            : true,
      )
      .slice(0, MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS);
  }, [choices, query]);
  const [activeIndex, setActiveIndex] = useState(0);
  const safeActiveIndex = visibleChoices.length === 0 ? 0 : activeIndex % visibleChoices.length;

  const focusInsideDialog = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const preferred = inputRef.current?.disabled
      ? dialog.querySelector<HTMLElement>(ENABLED_FOCUSABLE_SELECTOR)
      : inputRef.current;
    (preferred ?? dialog).focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keepFocusInside = (event: FocusEvent) => {
      if (!dialogRef.current?.contains(event.target as Node | null)) focusInsideDialog();
    };
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [focusInsideDialog, open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = choicesRef.current
      .slice(0, MAX_NODE_LAUNCH_CONFIGURATION_PICKER_ROWS)
      .findIndex(({ name }) => name === selectedName);
    setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex);
  }, [choiceIdentity, open, selectedName]);

  useEffect(() => {
    if (!open) return;
    const activeElement = document.activeElement;
    if (
      busy ||
      !dialogRef.current?.contains(activeElement) ||
      (activeElement instanceof HTMLButtonElement && activeElement.disabled) ||
      (activeElement instanceof HTMLInputElement && activeElement.disabled)
    ) {
      focusInsideDialog();
    }
  }, [busy, focusInsideDialog, open, state]);

  if (!open) return null;

  const close = () => {
    if (!busy) onClose();
  };
  const startActive = () => {
    const choice = visibleChoices[safeActiveIndex];
    if (!busy && state === "ready" && choice && choice.runnable !== false)
      onStartNamed(choice.name);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(ENABLED_FOCUSABLE_SELECTOR) ?? []),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (busy || visibleChoices.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((safeActiveIndex + direction + visibleChoices.length) % visibleChoices.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      startActive();
    }
  };
  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) close();
  };
  const activeChoice = visibleChoices[safeActiveIndex];

  return (
    <div onMouseDown={handleBackdrop} style={styles.backdrop}>
      <div
        aria-busy={busy || state === "loading"}
        aria-labelledby={titleId}
        aria-modal="true"
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        style={styles.dialog}
        tabIndex={-1}
      >
        <div style={styles.header}>
          <strong id={titleId}>{copy.title}</strong>
          <button
            aria-label={copy.closeLabel}
            disabled={busy}
            onClick={close}
            style={styles.close}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        <label style={styles.inputWrapper}>
          <Search aria-hidden="true" size={14} />
          <input
            aria-controls={listId}
            aria-expanded="true"
            aria-label={copy.searchLabel}
            aria-activedescendant={activeChoice ? `${listId}-${safeActiveIndex}` : undefined}
            disabled={busy}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={copy.searchPlaceholder}
            ref={inputRef}
            role="combobox"
            value={query}
          />
        </label>
        {diagnosticNotice ? (
          <div
            aria-label={diagnosticNotice.message}
            role="status"
            style={styles.message}
          >
            {diagnosticNotice.message}
          </div>
        ) : null}
        {state === "loading" || state === "idle" ? (
          <div role="status" style={styles.message}>
            {copy.loadingMessage}
          </div>
        ) : state === "error" ? (
          <div>
            <div role="alert" style={styles.message}>
              {error || copy.unavailableMessage}
            </div>
            <button disabled={busy} onClick={onRefresh} type="button">
              Retry
            </button>
          </div>
        ) : state === "empty" ? (
          <div role="status" style={styles.message}>
            {copy.emptyMessage}
          </div>
        ) : visibleChoices.length === 0 ? (
          <div role="status" style={styles.message}>
            {copy.noMatchesMessage}
          </div>
        ) : (
          <div aria-label={copy.listLabel} id={listId} role="listbox" style={styles.list}>
            {visibleChoices.map((choice, index) => (
              <button
                aria-selected={index === safeActiveIndex}
                disabled={busy || choice.runnable === false}
                id={`${listId}-${index}`}
                key={choice.name}
                onClick={() => onStartNamed(choice.name)}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
                style={{
                  ...styles.option,
                  ...(index === safeActiveIndex ? styles.optionActive : {}),
                }}
                type="button"
              >
                <span>
                  {choice.name}
                  {choice.default ? " (Default)" : ""}
                </span>
                <span style={styles.optionDetails}>
                  <span style={styles.target}>
                    {choice.targetKind === "compound"
                      ? `compound · ${choice.compoundMemberCount ?? 0} configurations`
                      : choice.targetKind}
                    {choice.source === "vscode" ? " · VS Code" : ""}
                  </span>
                  {choice.targetKind === "compound" && choice.hasPreLaunchTask ? (
                    <span style={styles.source}>preLaunchTask configured</span>
                  ) : choice.source === "vscode" && choice.preLaunchTask ? (
                    <span style={styles.source}>{`preLaunchTask: ${choice.preLaunchTask}`}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface NodeLaunchConfigurationPickerCopy {
  readonly closeLabel: string;
  readonly emptyMessage: string;
  readonly listLabel: string;
  readonly loadingMessage: string;
  readonly noMatchesMessage: string;
  readonly searchLabel: string;
  readonly searchPlaceholder: string;
  readonly title: string;
  readonly unavailableMessage: string;
}

function pickerCopy(
  intent: NodeLaunchConfigurationPickerIntent,
): NodeLaunchConfigurationPickerCopy {
  if (intent === "run") {
    return {
      closeLabel: "Close Run Without Debugging configuration picker",
      emptyMessage: "No Run Without Debugging configurations",
      listLabel: "Run Without Debugging configurations",
      loadingMessage: "Loading Run Without Debugging configurations…",
      noMatchesMessage: "No matching Run Without Debugging configurations",
      searchLabel: "Search Run Without Debugging configurations",
      searchPlaceholder: "Search configurations to run",
      title: "Select configuration to run without debugging",
      unavailableMessage: "Run Without Debugging configurations are unavailable.",
    };
  }
  return {
    closeLabel: "Close Node debug configuration picker",
    emptyMessage: "No Node debug configurations",
    listLabel: "Node debug configurations",
    loadingMessage: "Loading Node debug configurations…",
    noMatchesMessage: "No matching Node debug configurations",
    searchLabel: "Search Node debug configurations",
    searchPlaceholder: "Search configurations",
    title: "Select Node debug configuration",
    unavailableMessage: "Node debug configurations are unavailable.",
  };
}
