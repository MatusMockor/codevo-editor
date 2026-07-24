import { Copy, X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { JsTestTaskOutput } from "../domain/jsTestTask";

export interface JsTestOutputViewProps {
  readonly canCopyOutput: boolean;
  readonly id: string;
  readonly onClose: () => void;
  readonly onCopyOutput: () => boolean | Promise<boolean>;
  readonly output: JsTestTaskOutput;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    gap: 4,
    padding: "3px 5px",
  },
  body: {
    flex: 1,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    overflow: "auto",
    padding: "8px",
    whiteSpace: "pre-wrap",
  },
  empty: { color: "var(--text-muted)" },
  error: { color: "var(--status-error, #ef4444)" },
  header: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 8,
    padding: "6px 8px",
  },
  heading: { fontSize: 12, margin: 0 },
  panel: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  section: { margin: "0 0 12px" },
  sectionHeading: { fontFamily: "inherit", fontSize: 11, margin: "0 0 4px" },
  status: { padding: "4px 8px" },
  truncation: { color: "var(--text-muted)", marginTop: 4 },
};

export function JsTestOutputView({
  canCopyOutput,
  id,
  onClose,
  onCopyOutput,
  output,
}: JsTestOutputViewProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [copyStatus, setCopyStatus] = useState<"success" | "failure" | null>(null);

  useLayoutEffect(() => {
    bodyRef.current?.focus();
  }, []);

  const copyOutput = async (): Promise<void> => {
    setCopyStatus(null);
    try {
      setCopyStatus((await onCopyOutput()) ? "success" : "failure");
    } catch {
      setCopyStatus("failure");
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  };
  const empty =
    output.stdout.text.length === 0 &&
    !output.stdout.truncated &&
    output.stderr.text.length === 0 &&
    !output.stderr.truncated;

  return (
    <section aria-labelledby={`${id}-heading`} id={id} onKeyDown={keyDown} style={styles.panel}>
      <header style={styles.header}>
        <h2 id={`${id}-heading`} style={styles.heading}>
          JavaScript Test Output
        </h2>
        <button
          aria-label="Copy JavaScript test output"
          disabled={!canCopyOutput}
          onClick={() => void copyOutput()}
          style={styles.action}
          type="button"
        >
          <Copy aria-hidden="true" size={14} />
          Copy
        </button>
        <button
          aria-label="Close JavaScript test output"
          onClick={onClose}
          style={{ ...styles.action, marginLeft: "auto" }}
          type="button"
        >
          <X aria-hidden="true" size={14} />
          Close
        </button>
      </header>
      {copyStatus === "success" ? (
        <div aria-live="polite" role="status" style={styles.status}>
          JavaScript test output copied.
        </div>
      ) : null}
      {copyStatus === "failure" ? (
        <div role="alert" style={styles.status}>
          Could not copy JavaScript test output.
        </div>
      ) : null}
      <div
        aria-label="JavaScript test output"
        ref={bodyRef}
        role="log"
        style={styles.body}
        tabIndex={-1}
      >
        {empty ? (
          <span style={styles.empty}>The test runner produced no output.</span>
        ) : (
          <>
            <OutputStream
              label="Standard output"
              stream={output.stdout}
              testId="js-test-output-stdout"
            />
            <OutputStream
              error
              label="Standard error"
              stream={output.stderr}
              testId="js-test-output-stderr"
            />
          </>
        )}
      </div>
    </section>
  );
}

function OutputStream({
  error = false,
  label,
  stream,
  testId,
}: {
  readonly error?: boolean;
  readonly label: string;
  readonly stream: JsTestTaskOutput["stdout"];
  readonly testId: string;
}) {
  if (stream.text.length === 0 && !stream.truncated) return null;
  return (
    <section aria-label={label} data-testid={testId} style={styles.section}>
      <h3 style={styles.sectionHeading}>{label}</h3>
      {stream.text ? <span style={error ? styles.error : undefined}>{stream.text}</span> : null}
      {stream.truncated ? <div style={styles.truncation}>{label} was truncated.</div> : null}
    </section>
  );
}
