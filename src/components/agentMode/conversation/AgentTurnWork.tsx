import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { AgentTurn } from "../../../domain/agentThread";
import type { TextClipboardGateway } from "../../../domain/textClipboard";
import { AgentActivityItems } from "../AgentActivityItems";
import type { AgentProseContext, AgentProseStream } from "../AgentAssistantText";
import type { AgentTurnAttachmentImageViewer } from "../AgentTurnAttachments";
import { AgentTurnItemView } from "../AgentTurnItemView";
import { releaseFocusAfterPointerPress } from "./releasePointerFocus";
import { AgentWorkingDuration } from "../agentClock";
import type { AgentTurnErrorContext } from "../agentTurnErrorPresentation";
import { itemHighlight, type AgentTurnHighlight } from "../agentTurnHighlightModel";
import { agentTurnItemKey, normalizeAgentTurnEventOffset } from "../agentTurnItemKeys";
import type { AgentToolSettlement, AgentTurnItem } from "../agentTurnProjection";

export function AgentTurnWork({
  autoOpen,
  savedRawOutput,
  compacting,
  backgroundTitle,
  attachmentImages,
  errorContext,
  highlight,
  items,
  label,
  liveStatus,
  meta,
  prose,
  running,
  settlement,
  stream,
  textClipboard,
  trailing,
  turn,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentTurnHighlight | null;
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly trailing: ReactNode;
  readonly autoOpen: boolean;
  readonly savedRawOutput: ReactNode;
  readonly liveStatus: ReactNode;
  readonly prose: AgentProseContext;
  readonly compacting: boolean;
  readonly backgroundTitle: string | null;
  readonly running: boolean;
  readonly settlement: AgentToolSettlement;
  readonly stream: AgentProseStream;
  readonly label: string;
  readonly meta: string | null;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentTurn;
}) {
  const eventOffset = normalizeAgentTurnEventOffset(turn.firstEventOffset);
  return (
    <details className="agent-work" open={autoOpen || undefined}>
      <summary
        className="agent-work__summary cv-work-row"
        onMouseDown={releaseFocusAfterPointerPress}
      >
        <span className="agent-work__title cv-work-row__label">
          <AgentTurnWorkTitle
            backgroundTitle={backgroundTitle}
            compacting={compacting}
            label={label}
            running={running}
            turn={turn}
          />
        </span>
        <ChevronRight
          aria-hidden="true"
          className="agent-work__chevron cv-work-row__chevron"
          size={14}
        />
        {meta !== null && <span className="agent-work__counts cv-work-row__meta">{meta}</span>}
      </summary>
      <div className="agent-work__events">
        {savedRawOutput}
        <AgentActivityItems
          items={items}
          currentEventKey={
            highlight?.current?.kind === "event"
              ? agentTurnItemKey(highlight.current.eventIndex, eventOffset)
              : null
          }
          turn={stream === "streaming" ? "live" : "settled"}
          renderItem={(item, thought) => (
            <AgentTurnItemView
              attachmentImages={attachmentImages}
              errorContext={errorContext}
              highlight={itemHighlight(highlight, item.key, eventOffset)}
              groupHighlight={highlight}
              item={item}
              prose={prose}
              settlement={settlement}
              stream={stream}
              textClipboard={textClipboard}
              thought={thought}
            />
          )}
        />
        {trailing}
        {liveStatus}
      </div>
    </details>
  );
}

function AgentTurnWorkTitle({
  backgroundTitle,
  compacting,
  label,
  running,
  turn,
}: {
  readonly backgroundTitle: string | null;
  readonly compacting: boolean;
  readonly label: string;
  readonly running: boolean;
  readonly turn: AgentTurn;
}) {
  if (backgroundTitle !== null) return <>{backgroundTitle}</>;
  if (running) {
    return (
      <>
        {compacting ? "Turn elapsed " : "Working for "}
        <AgentWorkingDuration startedAtEpochMs={turn.startedAtEpochMs} />
      </>
    );
  }
  return <>{label}</>;
}
