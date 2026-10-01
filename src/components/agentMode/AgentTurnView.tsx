import { memo, useEffect, useMemo, useState } from "react";
import {
  agentTurnActivityWindowOf,
  useAgentTurnEarlierActivity,
  type AgentHistoryActivitySource,
} from "../../application/useAgentHistoryActivity";
import { agentTurnActivityWindowEvents } from "../../domain/agentTurnActivityWindow";
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
import {
  agentTurnEventUtf8Bytes,
  type AgentTurn,
  type AgentTurnStatus,
} from "../../domain/agentThread";
import { agentTurnContentLost } from "../../domain/agentTurnContentLoss";
import { isAgentBackgroundTurn } from "../../domain/agentTurnOrigin";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import { AgentActivityItems } from "./AgentActivityItems";
import type { AgentProseContext, AgentProseStream } from "./AgentAssistantText";
import { AgentBackgroundActivity } from "./AgentBackgroundActivity";
import { AgentCompactionActivity } from "./AgentCompactionActivity";
import { AgentSubagentDisclosure } from "./AgentSubagentDisclosure";
import { AgentToolDisclosureContext, useAgentTurnToolDisclosure } from "./AgentToolDisclosure";
import { AgentTurnArtifacts, type AgentArtifactScope } from "./AgentTurnArtifacts";
import type { AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import { AgentProviderErrorHint, AgentTurnItemView } from "./AgentTurnItemView";
import { AgentTurnOriginLabel, AgentTurnPrompt } from "./AgentTurnParts";
import { AgentTurnMeta } from "./conversation/AgentTurnMeta";
import { AgentLiveRow } from "./conversation/AgentLiveRow";
import { AgentTurnWork } from "./conversation/AgentTurnWork";
import { releaseFocusAfterPointerPress } from "./conversation/releasePointerFocus";
import {
  AgentTurnEarlierControl,
  AgentTurnLaterControl,
} from "./conversation/AgentTurnEarlierActivity";
import { useAgentScrollAnchor } from "./conversation/useAgentScrollAnchor";
import {
  agentFinalResponseItems,
  agentItemsBeforeFinalResponse,
} from "./conversation/agentTurnFinalResponse";
import { savedToolSettlement } from "./conversation/agentTurnWorkSettlement";
import { toolRowIcon } from "./agentToolRowIcon";
import { agentTurnMetaAgentLabel, agentTurnMetaAt } from "./conversation/agentTurnMetaLine";
import {
  agentActivityAttentionCount,
  agentActivityEndsThinking,
  agentWorkFoldLabel,
} from "./agentActivityGrouping";
import {
  agentBackgroundIndicator,
  agentBackgroundWait,
  agentBackgroundWaitTitle,
} from "./agentBackgroundIndicatorPresentation";
import { agentBackgroundSettledWorkFold } from "./agentBackgroundWorkFold";
import { agentTurnDurationLabel } from "./agentModePresentation";
import { agentThreadColumnKey } from "./agentThreadColumn";
import { agentTurnAttachmentViews } from "./agentTurnAttachmentPresentation";
import {
  agentTurnEndMarker,
  agentTurnHalt,
  createTurnErrorContext,
  repeatsLastError,
  turnFailure,
  type AgentTurnEndMarker,
} from "./agentTurnErrorPresentation";
import { agentTurnTiming } from "./agentTurnHeadPresentation";
import { itemHighlight, type AgentTurnHighlight } from "./agentTurnHighlightModel";
import {
  agentTurnItemKey,
  agentTurnLogItemKey,
  normalizeAgentTurnEventOffset,
} from "./agentTurnItemKeys";
import { agentTurnLogNoticeModel } from "./agentTurnLogNotice";
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
  type AgentTurnItem,
  type AgentTurnLiveActivity,
} from "./agentTurnProjection";

const WORKING_LABEL = "Working…";
const STANDALONE_COMPACT_PROMPT = /^\/compact(?:\s|$)/;

export interface AgentTurnViewProps {
  readonly activitySource?: AgentHistoryActivitySource | null;
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
  activitySource = null,
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
  const halt = agentTurnHalt(turn);
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
        undefined,
        halt,
      ),
    [
      turn.events,
      revealEventIndex,
      workspaceRoot,
      toolSettlement,
      eventOffset,
      renderedLimit,
      halt,
    ],
  );
  const running = settlement === "running";
  const readerSource =
    activitySource !== null && activitySource.scope.turnId === turn.turnId && turn.eventsTruncated
      ? activitySource
      : null;
  const earlier = useAgentTurnEarlierActivity(readerSource);
  const activityWindow = agentTurnActivityWindowOf(earlier.state);
  const [windowOpenedRunning, setWindowOpenedRunning] = useState(false);
  const windowStale = activityWindow !== null && windowOpenedRunning;
  const anchorRevision = useMemo(
    () => ({ activityWindow, renderedLimit }),
    [activityWindow, renderedLimit],
  );
  const scrollAnchor = useAgentScrollAnchor(anchorRevision);
  const earlierFailed = earlier.state.kind === "failed";
  useEffect(() => {
    if (earlierFailed) scrollAnchor.cancel();
  }, [earlierFailed, scrollAnchor]);
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
    () =>
      createTurnErrorContext(
        provider,
        turn.cliVersion,
        executionTarget,
        { status: turn.status, haltRequested: turn.haltRequested },
        projection.items,
      ),
    [executionTarget, projection.items, provider, turn.cliVersion, turn.haltRequested, turn.status],
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
  const windowEvents = useMemo(
    () => (activityWindow === null ? null : agentTurnActivityWindowEvents(activityWindow)),
    [activityWindow],
  );
  const windowAtTail = activityWindow !== null && !activityWindow.hasLater && !running;
  const savedWork = useMemo(
    () =>
      windowEvents === null
        ? null
        : agentTurnProjection(
            windowEvents.events,
            null,
            workspaceRoot,
            savedToolSettlement(turn.status),
            0,
            MAX_REVEALED_EVENTS_PER_TURN,
            (offset) => agentTurnLogItemKey(windowEvents.seqs[offset] ?? 0),
            halt,
          ),
    [halt, turn.status, windowEvents, workspaceRoot],
  );
  const savedItems = useMemo(() => {
    if (savedWork === null) return null;
    if (windowAtTail) return agentItemsBeforeFinalResponse(savedWork.items);
    return savedWork.items;
  }, [savedWork, windowAtTail]);
  const visibleItems = useMemo(() => {
    if (activityWindow === null) return workFold?.visibleItems ?? projection.items;
    if (foregroundRunning) return [];
    return agentFinalResponseItems(projection.items);
  }, [activityWindow, foregroundRunning, projection.items, workFold]);
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
  const foldThinking =
    activityWindow === null &&
    workFold !== null &&
    agentActivityEndsThinking(workFold.workItems, stream === "streaming" ? "live" : "settled");
  const liveStatus =
    compacting || backgroundOnly || liveActivity === null || empty ? null : (
      <AgentTurnLiveStatus
        activity={liveActivity}
        foldThinking={foldThinking}
        items={projection.items}
      />
    );
  const cursor = highlight?.current ?? null;
  const promptCurrent = cursor !== null && cursor.kind === "prompt" ? cursor.occurrence : null;
  const rawOutput =
    rawLines.length === 0 || !rawOutputDisclosed(turn.status) ? null : (
      <AgentRawOutput lines={rawLines} />
    );
  const failure = turnFailure(turn.status, errorContext);
  const endMarker = agentTurnEndMarker(turn.status, executionTarget);
  const currentEventKey =
    highlight?.current?.kind === "event"
      ? agentTurnItemKey(highlight.current.eventIndex, eventOffset)
      : null;

  return (
    <AgentToolDisclosureContext.Provider value={toolDisclosure}>
      <article
        aria-label={`Agent turn ${turn.turnId}`}
        className="agent-turn"
        data-agent-column={agentThreadColumnKey({ scope: "turn", turnId: turn.turnId })}
        data-agent-turn={turn.turnId}
        data-agent-turn-offset={eventOffset}
      >
        {isAgentBackgroundTurn(turn) ? (
          <AgentTurnOriginLabel prompt={turn.prompt} />
        ) : (
          <AgentTurnPrompt
            attachmentImages={attachmentImages}
            attachments={attachments}
            current={promptCurrent}
            prompt={turn.prompt}
            promptClipped={agentPromptLooksClipped(turn.prompt) && turn.promptRestored !== true}
            query={highlight?.query ?? ""}
            sentAtEpochMs={turn.startedAtEpochMs}
            textClipboard={textClipboard}
          />
        )}

        <div className="agent-answer">
          {turn.status.kind === "pending" && provider === "codex" && !compacting && (
            <p className="agent-note" role="status">
              Starting Codex…
            </p>
          )}
          <div className="agent-turn__events">
            <AgentTurnEarlierControl
              canRevealMemory={
                activityWindow === null &&
                projection.hiddenCount > 0 &&
                renderedLimit < MAX_REVEALED_EVENTS_PER_TURN
              }
              hiddenCount={activityWindow === null ? projection.hiddenCount : 0}
              logAvailable={readerSource !== null}
              onLoadEarlier={(from) => {
                scrollAnchor.capture(from);
                if (activityWindow === null) setWindowOpenedRunning(running);
                void earlier.loadEarlier(agentTurnEventsUtf8Bytes(turn.events));
              }}
              onRevealMemory={(from) => {
                scrollAnchor.capture(from);
                setRenderedLimit((limit) =>
                  agentRenderedEventLimit(limit + MAX_RENDERED_EVENTS_PER_TURN),
                );
              }}
              state={earlier.state}
            />
            <AgentSubagentDisclosure onOpenAgents={onOpenAgents} subagents={subagents} />
            {(workFold !== null || activityWindow !== null) && (
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
                  activityWindow === null ? toolSettlement : savedToolSettlement(turn.status)
                }
                stream={activityWindow === null ? stream : "settled"}
                label={workFoldTitle(
                  agentWorkFoldLabel(
                    savedItems ?? workFold?.workItems ?? [],
                    agentPartialWorkSummary(
                      workFold?.summary ?? "Activity",
                      activityWindow === null ? projection.hiddenCount : 0,
                    ),
                  ),
                  agentActivityAttentionCount(workFold?.workItems ?? [], halt),
                )}
                meta={
                  foregroundRunning
                    ? null
                    : agentTurnDurationLabel(
                        (turn.endedAtEpochMs ?? turn.startedAtEpochMs) - turn.startedAtEpochMs,
                      )
                }
                textClipboard={textClipboard}
                turn={turn}
                autoOpen={
                  activityWindow !== null ||
                  foregroundRunning ||
                  agentActivityAttentionCount(workFold?.workItems ?? [], halt) > 0
                }
                trailing={
                  <AgentTurnLaterControl
                    onLatest={(from) => {
                      scrollAnchor.capture(from, from.closest<HTMLElement>(".agent-work") ?? from);
                      setWindowOpenedRunning(false);
                      earlier.latest();
                    }}
                    onLoadLater={() => void earlier.loadLater()}
                    running={running || windowStale}
                    state={earlier.state}
                  />
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
            {workFold === null && activityWindow === null && liveStatus}
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
            readerAvailable={readerSource !== null}
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
          {!standaloneCompaction && (
            <AgentTurnMeta
              agentLabel={agentTurnMetaAgentLabel(provider, turn.launch)}
              atEpochMs={agentTurnMetaAt(turn)}
              timing={agentTurnTiming(turn)}
            />
          )}
        </div>
      </article>
    </AgentToolDisclosureContext.Provider>
  );
});

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
  readerAvailable,
  turnId,
  turnLog,
}: {
  readonly eventsTruncated: boolean;
  readonly readerAvailable: boolean;
  readonly turnId: string;
  readonly turnLog: AgentTurnLogFactsSource | null;
}) {
  const facts = useAgentTurnLogFacts(turnLog, turnId);
  const notices = agentTurnLogNoticeModel(facts, eventsTruncated, readerAvailable);
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
      <summary className="agent-raw__toggle" onMouseDown={releaseFocusAfterPointerPress}>
        Raw output
      </summary>
      <pre className="agent-raw__lines">{lines.map((line) => line.raw).join("\n")}</pre>
    </details>
  );
}

function agentTurnEventsUtf8Bytes(events: AgentTurn["events"]): number {
  return events.reduce((total, event) => total + agentTurnEventUtf8Bytes(event), 0);
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
  foldThinking,
  items,
}: {
  readonly activity: AgentTurnLiveActivity;
  readonly foldThinking: boolean;
  readonly items: ReadonlyArray<AgentTurnItem>;
}) {
  const working = activity.kind === "working";
  const thinking = working && items[items.length - 1]?.kind === "reasoning";
  if (thinking && foldThinking) return null;
  const live = working
    ? undefined
    : items.find((item) => item.kind === "tool" && item.toolId === activity.toolId);
  const Icon = live !== undefined && live.kind === "tool" ? toolRowIcon(live.rowKind) : null;
  return (
    <AgentLiveRow
      className={working ? "agent-tool-row--working" : "agent-tool-row-live"}
      icon={Icon === null ? undefined : <Icon size={16} strokeWidth={1.5} />}
      label={thinking ? "Thinking" : liveStatusText(activity, items)}
      tone={thinking ? "thinking" : "working"}
    />
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

function workFoldTitle(label: string, attention: number): string {
  if (attention === 0) return label;
  return `${label} · ${attention} need attention`;
}
