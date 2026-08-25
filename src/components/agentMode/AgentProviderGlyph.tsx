import { memo } from "react";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentProviderLabel } from "./agentSidebarPresentation";

const CLAUDE_MARK =
  "M8 1.1l1.05 4.05 3.6-2.3-2.3 3.6L14.9 7.5l-4.05 1.05 2.3 3.6-3.6-2.3L8.5 14.9 7.45 10.85l-3.6 2.3 2.3-3.6L1.1 8.5l4.05-1.05-2.3-3.6 3.6 2.3z";

const OPENAI_MARK =
  "M14.7 6.55a3.77 3.77 0 0 0-.32-3.1 3.82 3.82 0 0 0-4.11-1.83A3.78 3.78 0 0 0 7.42.35a3.82 3.82 0 0 0-3.64 2.64 3.78 3.78 0 0 0-2.52 1.83 3.82 3.82 0 0 0 .47 4.48 3.77 3.77 0 0 0 .32 3.1 3.82 3.82 0 0 0 4.11 1.83 3.78 3.78 0 0 0 2.85 1.27 3.82 3.82 0 0 0 3.64-2.65 3.78 3.78 0 0 0 2.52-1.83 3.82 3.82 0 0 0-.47-4.47zM9.01 14.51a2.83 2.83 0 0 1-1.82-.66l.09-.05 3.02-1.74a.49.49 0 0 0 .25-.43V7.37l1.28.74a.05.05 0 0 1 .02.03v3.53a2.85 2.85 0 0 1-2.84 2.84zM2.9 11.9a2.83 2.83 0 0 1-.34-1.9l.09.05 3.02 1.75a.49.49 0 0 0 .5 0l3.69-2.13v1.48a.05.05 0 0 1-.02.04l-3.05 1.76a2.85 2.85 0 0 1-3.89-1.05zM2.1 5.29a2.83 2.83 0 0 1 1.48-1.25v3.6a.49.49 0 0 0 .25.43l3.69 2.13-1.28.74a.05.05 0 0 1-.04 0L3.15 9.18A2.85 2.85 0 0 1 2.1 5.29zm10.49 2.44L8.9 5.6l1.28-.74a.05.05 0 0 1 .04 0l3.05 1.76a2.84 2.84 0 0 1-.44 5.12V8.16a.49.49 0 0 0-.25-.43zm1.27-1.92-.09-.05-3.02-1.75a.49.49 0 0 0-.5 0L6.56 6.14V4.66a.05.05 0 0 1 .02-.04l3.05-1.76a2.84 2.84 0 0 1 4.22 2.95zM5.86 8.75l-1.28-.74a.05.05 0 0 1-.02-.03V4.45a2.84 2.84 0 0 1 4.66-2.18l-.09.05-3.02 1.74a.49.49 0 0 0-.25.43zm.69-1.5L8.2 6.3l1.65.95v1.9l-1.65.95-1.65-.95z";

export const AgentProviderGlyph = memo(function AgentProviderGlyph({
  kind,
}: {
  readonly kind: AgentCliKind;
}) {
  const label = agentProviderLabel(kind);
  const path = kind === "claudeCode" ? CLAUDE_MARK : OPENAI_MARK;
  const modifier = kind === "claudeCode" ? "claude" : "codex";

  return (
    <span
      aria-label={label}
      className={`agent-row__provider agent-row__provider--${modifier}`}
      role="img"
      title={label}
    >
      <svg aria-hidden="true" fill="currentColor" height={14} viewBox="0 0 16 16" width={14}>
        <path d={path} />
      </svg>
    </span>
  );
});
