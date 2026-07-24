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

const ENABLED_FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MAX_SEARCH_LENGTH = 256;
const EMPTY_CANDIDATES: readonly NodeDebugAttachProcessPickerCandidate[] = Object.freeze([]);

export interface NodeDebugAttachProcessPickerCandidate {
  readonly presentationId: string;
  readonly label: string;
  readonly detail: string;
  readonly port: number;
}

export type NodeDebugAttachProcessPickerResult =
  | Readonly<{
      status: "ok";
      candidates: readonly NodeDebugAttachProcessPickerCandidate[];
      truncated: boolean;
    }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "error" }>;

export interface NodeDebugAttachProcessPickerProps {
  readonly onClose: () => void;
  readonly onManualPort: () => void;
  readonly onRetry: () => void;
  readonly onSelectCandidate: (presentationId: string) => void;
  readonly open: boolean;
  readonly result: NodeDebugAttachProcessPickerResult | null;
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
  footer: { display: "flex", gap: 8, justifyContent: "space-between" },
  header: { alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" },
  input: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 4,
    color: "inherit",
    flex: 1,
    minWidth: 0,
    padding: "6px 8px",
  },
  inputWrapper: { alignItems: "center", display: "flex", gap: 6 },
  list: { margin: 0, maxHeight: "48vh", overflow: "auto", padding: 0 },
  message: { color: "var(--text-muted)", padding: "12px 8px" },
  option: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "flex",
    gap: 12,
    justifyContent: "space-between",
    padding: "7px 8px",
    textAlign: "left",
    width: "100%",
  },
  optionActive: { background: "var(--background-active, rgba(127, 127, 127, 0.2))" },
  detail: { color: "var(--text-muted)", fontSize: 11 },
};

export function NodeDebugAttachProcessPicker({
  onClose,
  onManualPort,
  onRetry,
  onSelectCandidate,
  open,
  result,
}: NodeDebugAttachProcessPickerProps) {
  const titleId = useId();
  const listId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const focusInsideDialog = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    (
      inputRef.current ??
      dialog.querySelector<HTMLElement>(ENABLED_FOCUSABLE_SELECTOR) ??
      dialog
    ).focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keepFocusInside = (event: FocusEvent) => {
      if (!dialogRef.current?.contains(event.target as Node | null)) focusInsideDialog();
    };
    document.addEventListener("focusin", keepFocusInside);
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("focusin", keepFocusInside);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [focusInsideDialog, open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  const candidates = result?.status === "ok" ? result.candidates : EMPTY_CANDIDATES;
  const visibleCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? candidates.filter(({ detail, label, port }) =>
          `${label} ${detail} ${port}`.toLowerCase().includes(normalized),
        )
      : candidates;
  }, [candidates, query]);
  const safeActiveIndex =
    visibleCandidates.length === 0 ? 0 : activeIndex % visibleCandidates.length;
  const activeCandidate = visibleCandidates[safeActiveIndex];

  useEffect(() => {
    if (!open || !activeCandidate) return;
    optionRefs.current.get(activeCandidate.presentationId)?.scrollIntoView({ block: "nearest" });
  }, [activeCandidate, open]);

  if (!open) return null;

  const selectActive = () => {
    if (activeCandidate) onSelectCandidate(activeCandidate.presentationId);
  };
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(ENABLED_FOCUSABLE_SELECTOR) ?? []),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!activeCandidate) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex(
        (safeActiveIndex + direction + visibleCandidates.length) % visibleCandidates.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectActive();
    }
  };
  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) onClose();
  };

  return (
    <div onMouseDown={handleBackdrop} style={styles.backdrop}>
      <div
        aria-busy={result === null}
        aria-labelledby={titleId}
        aria-modal="true"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
        style={styles.dialog}
        tabIndex={-1}
      >
        <div style={styles.header}>
          <strong id={titleId}>Attach to Node.js process</strong>
          <button
            aria-label="Close process picker"
            onClick={onClose}
            style={styles.close}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        <label style={styles.inputWrapper}>
          <Search aria-hidden="true" size={14} />
          <input
            aria-activedescendant={
              activeCandidate ? `${listId}-option-${safeActiveIndex}` : undefined
            }
            aria-controls={listId}
            aria-expanded="true"
            aria-label="Search Node.js processes"
            maxLength={MAX_SEARCH_LENGTH}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search processes"
            ref={inputRef}
            role="combobox"
            value={query}
          />
        </label>
        {result === null ? (
          <div role="status" style={styles.message}>
            Searching for Node.js processes…
          </div>
        ) : result.status === "unavailable" ? (
          <div role="status" style={styles.message}>
            Process discovery is unavailable on this platform.
          </div>
        ) : result.status === "error" ? (
          <div role="alert" style={styles.message}>
            Unable to list Node.js processes.
          </div>
        ) : candidates.length === 0 ? (
          <div role="status" style={styles.message}>
            No debuggable Node.js processes found.
          </div>
        ) : visibleCandidates.length === 0 ? (
          <div role="status" style={styles.message}>
            No matching Node.js processes.
          </div>
        ) : (
          <div aria-label="Node.js processes" id={listId} role="listbox" style={styles.list}>
            {visibleCandidates.map((candidate, index) => (
              <button
                aria-selected={index === safeActiveIndex}
                id={`${listId}-option-${index}`}
                key={candidate.presentationId}
                onClick={() => onSelectCandidate(candidate.presentationId)}
                onMouseEnter={() => setActiveIndex(index)}
                ref={(element) => {
                  if (element) optionRefs.current.set(candidate.presentationId, element);
                  else optionRefs.current.delete(candidate.presentationId);
                }}
                role="option"
                style={{
                  ...styles.option,
                  ...(index === safeActiveIndex ? styles.optionActive : {}),
                }}
                tabIndex={-1}
                type="button"
              >
                <span>{candidate.label}</span>
                <span style={styles.detail}>{candidate.detail}</span>
              </button>
            ))}
          </div>
        )}
        {result?.status === "ok" && result.truncated ? (
          <div role="status" style={styles.message}>
            More processes were found. Refine the search to narrow the list.
          </div>
        ) : null}
        <div style={styles.footer}>
          <button onClick={onManualPort} type="button">
            Attach by port…
          </button>
          {result?.status === "error" || result?.status === "unavailable" ? (
            <button onClick={onRetry} type="button">
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
