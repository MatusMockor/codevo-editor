import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TextClipboardGateway } from "../../domain/textClipboard";

type AgentMessageCopyState = "idle" | "copied" | "failed";

const FEEDBACK_DURATION_MS = 1_600;

export function AgentMessageCopyButton({
  clipboard,
  label,
  text,
}: {
  readonly clipboard: TextClipboardGateway | null;
  readonly label: string;
  readonly text: string;
}) {
  const [state, setState] = useState<AgentMessageCopyState>("idle");
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      attemptRef.current += 1;
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  useEffect(() => {
    attemptRef.current += 1;
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setState("idle");
  }, [text]);

  const report = (next: Exclude<AgentMessageCopyState, "idle">): void => {
    if (!mountedRef.current) return;
    setState(next);
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      resetTimerRef.current = null;
      if (mountedRef.current) setState("idle");
    }, FEEDBACK_DURATION_MS);
  };

  const copy = async (): Promise<void> => {
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    try {
      if (clipboard === null || !clipboard.canWriteText()) throw new Error("Clipboard unavailable");
      await clipboard.writeText(text);
      if (attempt === attemptRef.current) report("copied");
    } catch {
      if (attempt === attemptRef.current) report("failed");
    }
  };

  const actionLabel =
    state === "copied"
      ? `Copied ${label}`
      : state === "failed"
        ? `Could not copy ${label}`
        : `Copy ${label}`;

  return (
    <button
      aria-label={actionLabel}
      className={`agent-message-copy${state === "copied" ? " agent-message-copy--copied" : ""}${state === "failed" ? " agent-message-copy--failed" : ""}`}
      onClick={() => void copy()}
      title={actionLabel}
      type="button"
    >
      {state === "copied" ? (
        <Check aria-hidden="true" size={13} />
      ) : (
        <Copy aria-hidden="true" size={13} />
      )}
    </button>
  );
}
