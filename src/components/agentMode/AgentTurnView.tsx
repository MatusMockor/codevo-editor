import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  agentTurnLogEvidence,
  useAgentTurnLogFacts,
  type AgentTurnLogFactsSource,
} from "../../application/agentTurnLogStatusStore";
import { useAgentBackgroundActivity } from "./useAgentBackgroundActivity";
import { agentCompactionState } from "../../domain/agentCompactionState";
import { agentProviderErrorHeadline } from "../../domain/agentOutput/agentProviderError";
import { isAgentRawOutputNoise } from "../../domain/agentOutput/agentRawOutput";
import { agentPromptLooksClipped } from "../../domain/agentPromptClipping";
import type { AgentRuntimeSubagents } from "../../domain/agentRuntimeSubagent";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import { agentTurnContentLost } from "../../domain/agentTurnContentLoss";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentActivityItems } from "./AgentActivityItems";
import type { AgentProseContext, AgentProseStream } from "./AgentAssistantText";
import { AgentBackgroundActivity } from "./AgentBackgroundActivity";
import { AgentCompactionActivity } from "./AgentCompactionActivity";
import type { AgentHistoryWork } from "./AgentHistoryActivity";
import { AgentSubagentDisclosure } from "./AgentSubagentDisclosure";
import { AgentToolDisclosureContext, useAgentTurnToolDisclosure } from "./AgentToolDisclosure";
import { AgentTurnArtifacts, type AgentArtifactScope } from "./AgentTurnArtifacts";
import type { AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import { AgentProviderErrorHint, AgentTurnItemView } from "./AgentTurnItemView";
import { AgentTurnHead, AgentTurnPrompt } from "./AgentTurnParts";
import { agentActivityAttentionCount } from "./agentActivityGrouping";
import {
  agentBackgroundIndicator,
  agentBackgroundWait,
  agentBackgroundWaitTitle,
} from "./agentBackgroundIndicatorPresentation";
import { agentBackgroundSettledWorkFold } from "./agentBackgroundWorkFold";
import { AgentWorkingDuration } from "./agentClock";
import { agentTurnDurationLabel } from "./agentModePresentation";
import { agentThreadColumnKey } from "./agentThreadColumn";
import { agentTurnAttachmentViews } from "./agentTurnAttachmentPresentation";
import {
  agentTurnEndMarker,
  createTurnErrorContext,
  repeatsLastError,
  turnFailure,
  type AgentTurnEndMarker,
  type AgentTurnErrorContext,
} from "./agentTurnErrorPresentation";
import { agentTurnTiming } from "./agentTurnHeadPresentation";
import { itemHighlight, type AgentTurnHighlight } from "./agentTurnHighlightModel";
import { agentTurnItemsMissingFrom } from "./agentTurnItemEquality";
import { agentTurnItemKey, normalizeAgentTurnEventOffset } from "./agentTurnItemKeys";
import { agentTurnLogNoticeModel } from "./agentTurnLogNotice";
import { agentTurnLaunchLabel } from "./agentTurnMetaPresentation";
import {
  MAX_RENDERED_EVENTS_PER_TURN,
  MAX_REVEALED_EVENTS_PER_TURN,
  agentRenderedEventLimit,
  agentToolSettlement,
  agentTurnLiveActivity,
  agentTurnProjection,
  agentTurnSettlement,
  agentTurnWorkFold,
  agentPartialWorkSummary,
  type AgentRawLine,
  type AgentToolSettlement,
  type AgentTurnItem,
  type AgentTurnLiveActivity,
} from "./agentTurnProjection";
import "./agentTranscript.css";

const WORKING_LABEL = "Working…";
const STANDALONE_COMPACT_PROMPT = /^\/compact(?:\s|$)/;

export interface AgentTurnViewProps {
  readonly historyWork: AgentHistoryWork;
  readonly artifactScope?: AgentArtifactScope | null;
  readonly attachmentImages?: AgentTurnAttachmentImageViewer | null;
  readonly highlight?: AgentTurnHighlight | null;
  readonly prose: AgentProseContext;
  readonly provider: AgentCliKind;
  readonly executionTarget: "local" | "remote";
  readonly renderProbe?: (turnId: string) => void;
  readonly onOpenAgents: () => void;
  readonly subagents: AgentRuntimeSubagents;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentTurn;
  readonly turnLog?: AgentTurnLogFactsSource | null;
  readonly workspaceRoot?: string | null;
}

export const AgentTurnView = memo(function AgentTurnView({
  historyWork,
  artifactScope = null,
  attachmentImages = null,
  highlight = null,
  executionTarget,
  onOpenAgents,
  prose,
  provider,
  renderProbe,
  subagents,
  textClipboard,
  turn,
  turnLog = null,
  workspaceRoot = null,
}: AgentTurnViewProps) {
  renderProbe?.(turn.turnId);
  const attachments = useMemo(() => agentTurnAttachmentViews(turn.attachments), [turn.attachments]);
  const revealEventIndex =
    highlight?.current?.kind === "event" ? highlight.current.eventIndex : null;
  const settlement = agentTurnSettlement(turn.status);
  const toolSettlement = agentToolSettlement(turn.status);
  const eventOffset = normalizeAgentTurnEventOffset(turn.firstEventOffset);
  const [renderedLimit, setRenderedLimit] = useState(MAX_RENDERED_EVENTS_PER_TURN);
  const projection = useMemo(
    () =>
      agentTurnProjection(
        turn.events,
        revealEventIndex,
        workspaceRoot,
        toolSettlement,
        eventOffset,
        renderedLimit,
      ),
    [turn.events, revealEventIndex, workspaceRoot, toolSettlement, eventOffset, renderedLimit],
  );
  const running = settlement === "running";
  const [streamed, setStreamed] = useState(running);

  useEffect(() => {
    if (!running) return;
    if (streamed) return;
    setStreamed(true);
  }, [running, streamed]);

  const logFacts = turnLog?.factsOf(turn.turnId) ?? null;
  const logEvidence = useMemo(() => agentTurnLogEvidence(logFacts), [logFacts]);
  const contentLost = agentTurnContentLost(turn.eventsTruncated, logEvidence);
  const background = useAgentBackgroundActivity(turn.turnId, turn.events, running, contentLost);
  const backgroundOnly =
    provider === "claudeCode" && background.foregroundSettled && background.phase !== "inactive";
  const backgroundIndicator = useMemo(
    () => agentBackgroundIndicator(background, subagents, provider),
    [background, subagents, provider],
  );
  const backgroundTitle = backgroundOnly
    ? agentBackgroundWaitTitle(agentBackgroundWait(background, subagents))
    : null;
  const foregroundRunning = running && !backgroundOnly;
  const stream = proseStream(foregroundRunning, streamed);
  const errorContext = useMemo(
    () => createTurnErrorContext(provider, turn.cliVersion, executionTarget, projection.items),
    [executionTarget, projection.items, provider, turn.cliVersion],
  );
  const rawLines = useMemo(
    () =>
      projection.rawLines.filter((line) => !isAgentRawOutputNoise(provider, line.stream, line.raw)),
    [projection.rawLines, provider],
  );
  const empty = projection.items.length === 0 && rawLines.length === 0;
  const workFold = useMemo(
    () =>
      backgroundOnly
        ? agentBackgroundSettledWorkFold(projection.items)
        : agentTurnWorkFold(projection.items, foregroundRunning),
    [backgroundOnly, foregroundRunning, projection.items],
  );
  const savedWork = useMemo(
    () =>
      historyWork.turn === null
        ? null
        : agentTurnProjection(
            historyWork.turn.events,
            null,
            workspaceRoot,
            savedToolSettlement(historyWork.turn.status),
            normalizeAgentTurnEventOffset(historyWork.turn.firstEventOffset),
          ),
    [historyWork.turn, workspaceRoot],
  );
  const visibleItems = workFold?.visibleItems ?? projection.items;
  const savedItems = useMemo(
    () => (savedWork === null ? null : agentTurnItemsMissingFrom(savedWork.items, visibleItems)),
    [savedWork, visibleItems],
  );
  const savedRawLines = useMemo(
    () =>
      savedWork?.rawLines.filter(
        (line) => !isAgentRawOutputNoise(provider, line.stream, line.raw),
      ) ?? [],
    [provider, savedWork],
  );
  const liveActivity = agentTurnLiveActivity(turn);
  const compaction = agentCompactionState(provider, turn);
  const compacting = compaction.kind === "compacting";
  const standaloneCompaction =
    provider === "claudeCode" &&
    STANDALONE_COMPACT_PROMPT.test(turn.prompt.trim()) &&
    (compacting || projection.items.some((item) => item.kind === "contextCompaction")) &&
    compaction.kind !== "failed" &&
    (turn.status.kind === "pending" ||
      turn.status.kind === "running" ||
      (turn.status.kind === "exited" && turn.status.exitCode === 0)) &&
    rawLines.length === 0 &&
    projection.hiddenCount === 0 &&
    !contentLost &&
    projection.items.every(
      (item) =>
        item.kind === "contextCompaction" ||
        (item.kind === "result" && !item.isError && item.text.trim() === ""),
    );
  const toolDisclosure = useAgentTurnToolDisclosure();
  const liveStatus =
    compacting || backgroundOnly || liveActivity === null || empty ? null : (
      <AgentTurnLiveStatus activity={liveActivity} items={projection.items} />
    );
  const cursor = highlight?.current ?? null;
  const promptCurrent = cursor !== null && cursor.kind === "prompt" ? cursor.occurrence : null;
  const rawOutput =
    rawLines.length === 0 || !rawOutputDisclosed(turn.status) ? null : (
      <AgentRawOutput lines={rawLines} />
    );
  const failure = turnFailure(turn.status, errorContext);
  const endMarker = agentTurnEndMarker(turn.status, executionTarget);
  const launchLabel = agentTurnLaunchLabel(turn.launch);
  const currentEventKey =
    highlight?.current?.kind === "event"
      ? agentTurnItemKey(highlight.current.eventIndex, eventOffset)
      : null;
  const canShowEarlier = renderedLimit < MAX_REVEALED_EVENTS_PER_TURN;
  const showEarlier = () =>
    setRenderedLimit((limit) => agentRenderedEventLimit(limit + MAX_RENDERED_EVENTS_PER_TURN));

  return (
    <AgentToolDisclosureContext.Provider value={toolDisclosure}>
      <article
        aria-label={`Agent turn ${turn.turnId}`}
        className="agent-turn"
        data-agent-column={agentThreadColumnKey({ scope: "turn", turnId: turn.turnId })}
        data-agent-turn={turn.turnId}
        data-agent-turn-offset={eventOffset}
      >
        <AgentTurnPrompt
          attachmentImages={attachmentImages}
          attachments={attachments}
          current={promptCurrent}
          prompt={turn.prompt}
          promptClipped={agentPromptLooksClipped(turn.prompt) && turn.promptRestored !== true}
          query={highlight?.query ?? ""}
          textClipboard={textClipboard}
        />

        <div className="agent-answer">
          {!standaloneCompaction && (
            <AgentTurnHead
              launchLabel={launchLabel}
              provider={provider}
              startedAtEpochMs={turn.startedAtEpochMs}
              timing={agentTurnTiming(turn)}
            />
          )}

          {turn.status.kind === "pending" && provider === "codex" && !compacting && (
            <p className="agent-note" role="status">
              Starting Codex…
            </p>
          )}
          {projection.hiddenCount > 0 && (
            <AgentTurnEarlierEvents
              canShowEarlier={canShowEarlier}
              hiddenCount={projection.hiddenCount}
              onShowEarlier={showEarlier}
            />
          )}

          <div className="agent-turn__events">
            <AgentSubagentDisclosure onOpenAgents={onOpenAgents} subagents={subagents} />
            {(workFold !== null || historyWork.available) && (
              <AgentTurnWork
                compacting={compacting}
                backgroundTitle={backgroundTitle}
                liveStatus={liveStatus}
                attachmentImages={attachmentImages}
                errorContext={errorContext}
                highlight={highlight}
                items={savedItems ?? workFold?.workItems ?? []}
                key={running ? "running-work" : "settled-work"}
                prose={prose}
                running={foregroundRunning}
                settlement={
                  historyWork.turn === null
                    ? toolSettlement
                    : savedToolSettlement(historyWork.turn.status)
                }
                stream={historyWork.turn === null ? stream : "settled"}
                summary={agentPartialWorkSummary(
                  workFold?.summary ?? "Activity",
                  historyWork.turn === null ? projection.hiddenCount : 0,
                )}
                textClipboard={textClipboard}
                turn={historyWork.turn ?? turn}
                historyWork={historyWork}
                autoOpen={
                  foregroundRunning || agentActivityAttentionCount(workFold?.workItems ?? []) > 0
                }
                savedRawOutput={
                  savedRawLines.length > 0 ? <AgentRawOutput lines={savedRawLines} /> : null
                }
              />
            )}
            <AgentActivityItems
              items={visibleItems}
              currentEventKey={currentEventKey}
              turn={stream === "streaming" ? "live" : "settled"}
              renderItem={(item, thought) => (
                <AgentTurnItemView
                  attachmentImages={attachmentImages}
                  errorContext={errorContext}
                  highlight={itemHighlight(highlight, item.key, eventOffset)}
                  groupHighlight={highlight}
                  item={item}
                  prose={prose}
                  settlement={toolSettlement}
                  stream={stream}
                  textClipboard={textClipboard}
                  thought={thought}
                />
              )}
            />
            {workFold === null && !historyWork.available && liveStatus}
            {!compacting && (
              <AgentBackgroundActivity
                indicator={backgroundIndicator}
                onOpenAgents={onOpenAgents}
              />
            )}
            {compaction.kind === "failed" && (
              <p className="agent-note agent-note--warning" role="status">
                Context compaction failed{compaction.message ? `: ${compaction.message}` : "."}
              </p>
            )}
            {compacting && <AgentCompactionActivity />}
            {empty &&
              foregroundRunning &&
              compaction.kind === "idle" &&
              !(turn.status.kind === "pending" && provider === "codex") && (
                <p className="agent-note">
                  Waiting for output…
                  <span aria-hidden="true" className="agent-well__caret" />
                </p>
              )}
          </div>

          {!running && artifactScope !== null && (
            <AgentTurnArtifacts evidence={logEvidence} scope={artifactScope} turn={turn} />
          )}

          {rawOutput !== null && <div className="agent-message-actions">{rawOutput}</div>}

          <AgentTurnLogNotices
            eventsTruncated={turn.eventsTruncated}
            turnId={turn.turnId}
            turnLog={turnLog}
          />

          {failure !== null && !repeatsLastError(failure, projection.items, errorContext) && (
            <section className="agent-finale agent-finale--bad">
              <span className="agent-microlabel agent-microlabel--bad">run failed</span>
              <p className="agent-finale__body">
                {agentProviderErrorHeadline(failure, errorContext.installedVersion)}
              </p>
              <AgentProviderErrorHint error={failure} context={errorContext} />
            </section>
          )}

          {endMarker !== null && <AgentTurnEnd marker={endMarker} />}
        </div>
      </article>
    </AgentToolDisclosureContext.Provider>
  );
});

function AgentTurnEarlierEvents({
  canShowEarlier,
  hiddenCount,
  onShowEarlier,
}: {
  readonly canShowEarlier: boolean;
  readonly hiddenCount: number;
  readonly onShowEarlier: () => void;
}) {
  const next = Math.min(hiddenCount, MAX_RENDERED_EVENTS_PER_TURN);
  return (
    <p className="agent-note agent-turn-earlier">
      <span>
        {hiddenCount} earlier {hiddenCount === 1 ? "event" : "events"} hidden
      </span>
      {canShowEarlier && (
        <button className="agent-turn-earlier__action" onClick={onShowEarlier} type="button">
          Show {next} earlier
        </button>
      )}
    </p>
  );
}

function AgentTurnEnd({ marker }: { readonly marker: AgentTurnEndMarker }) {
  const detail = marker.kind === "stopped" ? null : marker.detail;
  return (
    <p className="agent-turn-end" data-kind={marker.kind} role="status">
      <span aria-hidden="true" className="agent-turn-end__rule" />
      <span className="agent-turn-end__label">{marker.label}</span>
      {detail !== null && <span className="agent-turn-end__detail">{detail}</span>}
      <span aria-hidden="true" className="agent-turn-end__rule" />
    </p>
  );
}

function AgentTurnLogNotices({
  eventsTruncated,
  turnId,
  turnLog,
}: {
  readonly eventsTruncated: boolean;
  readonly turnId: string;
  readonly turnLog: AgentTurnLogFactsSource | null;
}) {
  const facts = useAgentTurnLogFacts(turnLog, turnId);
  const notices = agentTurnLogNoticeModel(facts, eventsTruncated);
  if (notices.loss === null && notices.unsaved === null) return null;
  return (
    <>
      {notices.loss !== null && <p className="agent-note agent-note--warning">{notices.loss}</p>}
      {notices.unsaved !== null && (
        <p className="agent-note agent-note--warning">{notices.unsaved}</p>
      )}
    </>
  );
}

function AgentRawOutput({ lines }: { readonly lines: ReadonlyArray<AgentRawLine> }) {
  return (
    <details className="agent-raw" open>
      <summary className="agent-raw__toggle">Raw output</summary>
      <pre className="agent-raw__lines">{lines.map((line) => line.raw).join("\n")}</pre>
    </details>
  );
}

function AgentTurnWork({
  autoOpen,
  historyWork,
  savedRawOutput,
  compacting,
  backgroundTitle,
  attachmentImages,
  errorContext,
  highlight,
  items,
  liveStatus,
  prose,
  running,
  settlement,
  stream,
  summary,
  textClipboard,
  turn,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentTurnHighlight | null;
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly historyWork: AgentHistoryWork;
  readonly autoOpen: boolean;
  readonly savedRawOutput: ReactNode;
  readonly liveStatus: ReactNode;
  readonly prose: AgentProseContext;
  readonly compacting: boolean;
  readonly backgroundTitle: string | null;
  readonly running: boolean;
  readonly settlement: AgentToolSettlement;
  readonly stream: AgentProseStream;
  readonly summary: string;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentTurn;
}) {
  const eventOffset = normalizeAgentTurnEventOffset(turn.firstEventOffset);
  const attention = agentActivityAttentionCount(items);
  return (
    <details className="agent-work" open={autoOpen || undefined}>
      <summary
        className="agent-work__summary"
        onClick={(event) => {
          const disclosure = event.currentTarget.parentElement;
          if (disclosure instanceof HTMLDetailsElement && !disclosure.open) historyWork.open();
        }}
      >
        <span className="agent-work__title">
          <AgentTurnWorkTitle
            backgroundTitle={backgroundTitle}
            compacting={compacting}
            running={running}
            turn={turn}
          />
        </span>
        <span className="agent-work__counts">
          {summary}
          {attention > 0 && ` · ${attention} need attention`}
        </span>
        <ChevronDown aria-hidden="true" className="agent-work__chevron" size={14} />
      </summary>
      <div className="agent-work__events">
        {historyWork.controls}
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
        {liveStatus}
      </div>
    </details>
  );
}

function AgentTurnWorkTitle({
  backgroundTitle,
  compacting,
  running,
  turn,
}: {
  readonly backgroundTitle: string | null;
  readonly compacting: boolean;
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
  return (
    <>
      Worked for{" "}
      {agentTurnDurationLabel(
        (turn.endedAtEpochMs ?? turn.startedAtEpochMs) - turn.startedAtEpochMs,
      )}
    </>
  );
}

function savedToolSettlement(status: AgentTurnStatus): AgentToolSettlement {
  const settlement = agentToolSettlement(status);
  return settlement === "running" ? "settled" : settlement;
}

function proseStream(running: boolean, streamed: boolean): AgentProseStream {
  if (running) return "streaming";
  if (streamed) return "streamed";
  return "settled";
}

function rawOutputDisclosed(status: AgentTurnStatus): boolean {
  if (status.kind === "failed") return true;
  if (status.kind === "interrupted") return true;
  return status.kind === "exited" && status.exitCode !== 0;
}

function AgentTurnLiveStatus({
  activity,
  items,
}: {
  readonly activity: AgentTurnLiveActivity;
  readonly items: ReadonlyArray<AgentTurnItem>;
}) {
  const working = activity.kind === "working";
  return (
    <div
      aria-live="polite"
      className={working ? "agent-tool-row agent-tool-row--working" : "agent-tool-row-live"}
      role="status"
    >
      <span className="agent-tool-row__label">{liveStatusText(activity, items)}</span>
    </div>
  );
}

function liveStatusText(
  activity: AgentTurnLiveActivity,
  items: ReadonlyArray<AgentTurnItem>,
): string {
  if (activity.kind === "working") return WORKING_LABEL;
  const live = items.find((item) => item.kind === "tool" && item.toolId === activity.toolId);
  if (live === undefined || live.kind !== "tool") return WORKING_LABEL;
  return live.label;
}
