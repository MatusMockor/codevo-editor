import { AgentArtifactPreviewScope } from "./AgentOutputArtifacts";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import { AgentTurnArtifacts, type AgentArtifactScope } from "./AgentTurnArtifacts";
import { AgentThreadUsage } from "./AgentThreadUsage";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bot,
  ChevronDown,
  Clock3,
  FileText,
  Globe,
  Play,
  Search,
  SquarePen,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { DeferredFollowUp } from "../../application/agentDeferredFollowUps";
import type { AgentAttachmentImagesSurface } from "../../application/useAgentAttachmentImages";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import { agentCompactionState } from "../../domain/agentCompactionState";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import {
  createTurnErrorContext,
  repeatsLastError,
  suppressGenericFailure,
  turnFailure,
  type AgentTurnErrorContext,
} from "./agentTurnErrorPresentation";
import { isAgentRawOutputNoise } from "../../domain/agentOutput/agentRawOutput";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { ExternalSessionExchange } from "../../domain/externalAgentSession";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { agentExternalOriginNote, type AgentThreadRevealRequest } from "./agentSidebarPresentation";
import { AgentWorkingDuration } from "./agentClock";
import { AgentThreadChangesCue } from "./AgentThreadChangesCue";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { AgentImportedHistory, type AgentExternalHistoryState } from "./AgentImportedHistory";
import { AgentQueuedPrompt, AgentTurnHead, AgentTurnPrompt } from "./AgentTurnParts";
import type { AgentTurnAttachmentImageViewer } from "./AgentTurnAttachments";
import { AgentAttachmentLightbox } from "./AgentAttachmentLightbox";
import { agentTurnAttachmentViews } from "./agentTurnAttachmentPresentation";
import { useAgentAttachmentLightbox } from "./useAgentAttachmentLightbox";
import { useAgentTurnAttachmentImagePort } from "./useAgentTurnAttachmentImages";
import { agentTurnTiming } from "./agentTurnHeadPresentation";
import {
  AgentAssistantText,
  type AgentItemHighlight,
  type AgentProseContext,
  type AgentProseStream,
} from "./AgentAssistantText";
import { openAgentMarkdownLink, type AgentExternalLinkOpener } from "./agentMarkdownLinks";
import { useViewportWidth } from "../useViewportWidth";
import { AgentThreadMinimap, MIN_AGENT_MINIMAP_ENTRIES } from "./AgentThreadMinimap";
import {
  agentMinimapHasPersistentGutter,
  agentMinimapHitStripWidth,
} from "./agentMinimapPlacement";
import { agentMinimapEntryIndex, agentThreadMinimapModel } from "./agentThreadMinimapPresentation";
import { agentThreadColumnKey, type AgentThreadColumnAnchor } from "./agentThreadColumn";
import { useAgentThreadTurnInView } from "./useAgentThreadTurnInView";
import { agentImportedHighlights, agentImportedTurns } from "./agentImportedPresentation";
import { HighlightRun } from "./agentThreadHighlight";
import { useAgentMarkdownRenderer } from "./useAgentMarkdown";
import { createIntersectionAgentMarkdownViewport } from "../../infrastructure/viewport/intersectionAgentMarkdownViewport";
import {
  agentTurnCarriesAttachments,
  agentTurnLiveActivity,
  agentTurnSettlement,
  agentWorktreeRemovalLabel,
  agentTurnDurationLabel,
  agentTurnProjection,
  agentTurnSubagentSummary,
  agentTurnWorkFold,
  isAgentSubagentToolItem,
  type AgentRawLine,
  type AgentTurnLiveActivity,
  type AgentSubagentEntry,
  type AgentSubagentSummary,
  type AgentTurnItem,
} from "./agentModePresentation";
import {
  unsupportedToolRowKind,
  type AgentToolRowKind,
  type AgentToolRowStatus,
} from "../../domain/agentToolRowPresentation";

const WORKING_LABEL = "Working\u2026";

const NO_FIND_HITS: ReadonlyArray<AgentThreadFindHit> = [];
const NO_DEFERRED_FOLLOW_UPS: ReadonlyArray<DeferredFollowUp> = [];
const NO_EXCHANGES: ReadonlyArray<ExternalSessionExchange> = [];

export const AGENT_FIND_REVEAL_INSET = 34;

type AgentTurnHighlightCursor =
  | { readonly kind: "prompt"; readonly occurrence: number }
  | { readonly kind: "event"; readonly eventIndex: number; readonly occurrence: number };

interface AgentTurnHighlight {
  readonly query: string;
  readonly current: AgentTurnHighlightCursor | null;
}

interface AgentRevealTarget {
  readonly element: HTMLElement;
  readonly block: "start" | "center";
}

export interface AgentThreadSessionProps {
  readonly artifactLoader?: AgentArtifactLoader | null;
  readonly artifactPreview?: AgentArtifactPreviewPort | null;
  readonly thread: AgentThreadView | null;
  readonly deferredFollowUps?: ReadonlyArray<DeferredFollowUp>;
  onRemoveDeferredFollowUp?(threadId: string, id: string): void;
  onEditDeferredFollowUp?(threadId: string, id: string): void;
  onResumeDeferredFollowUps?(threadId: string): Promise<void>;
  onSendDeferredFollowUpNow?(threadId: string, id: string): Promise<void>;
  readonly composerRepositoryLabel: string | null;
  readonly turnRenderProbe?: (turnId: string) => void;
  readonly findQuery?: string;
  readonly findHits?: ReadonlyArray<AgentThreadFindHit>;
  readonly findHitIndex?: number;
  readonly findOpen?: boolean;
  readonly findBar?: ReactNode;
  readonly goToTurnSignal?: number;
  readonly reveal?: AgentThreadRevealRequest | null;
  readonly textClipboard?: TextClipboardGateway | null;
  readonly markdownRenderer?: AgentMarkdownRenderer | null;
  readonly markdownViewport?: AgentMarkdownViewport | null;
  readonly openExternalLink?: AgentExternalLinkOpener;
  readonly externalHistoryState?: AgentExternalHistoryState;
  readonly attachmentImages?: AgentAttachmentImagesSurface | null;
  readonly onRevealAttachment?: (threadId: string, attachmentId: string) => void;
  readonly onRetryExternalHistory?: () => void;
  onReviewInDiff(threadId: string): void;
}

export function AgentThreadSession(props: AgentThreadSessionProps) {
  const thread = props.thread;
  if (thread === null) {
    return <AgentThreadSessionEmpty repositoryLabel={props.composerRepositoryLabel} />;
  }

  return <AgentThreadSessionBody {...props} thread={thread} />;
}

type AgentThreadSessionBodyProps = AgentThreadSessionProps & {
  readonly thread: AgentThreadView;
};

function AgentThreadSessionBody({
  artifactLoader = null,
  artifactPreview = null,
  attachmentImages = null,
  deferredFollowUps = NO_DEFERRED_FOLLOW_UPS,
  onRemoveDeferredFollowUp,
  onEditDeferredFollowUp,
  onResumeDeferredFollowUps,
  onSendDeferredFollowUpNow,
  onRevealAttachment,
  findBar = null,
  findHitIndex,
  findHits,
  findOpen = false,
  findQuery,
  goToTurnSignal = 0,
  onReviewInDiff,
  reveal = null,
  textClipboard = null,
  markdownRenderer,
  markdownViewport,
  openExternalLink = openAgentMarkdownLink,
  externalHistoryState,
  onRetryExternalHistory,
  thread,
  turnRenderProbe,
}: AgentThreadSessionBodyProps) {
  const record = thread.thread;
  const threadId = record.threadId;
  const serverId = thread.execution?.serverId;
  const runnerId = thread.execution?.runnerId;
  const artifactScope = useMemo<AgentArtifactScope | null>(
    () =>
      artifactLoader === null || artifactPreview === null
        ? null
        : {
            owner: record.owner,
            threadId,
            serverId,
            runnerId,
            loader: artifactLoader,
            preview: artifactPreview,
          },
    [artifactLoader, artifactPreview, record.owner, threadId, serverId, runnerId],
  );
  const attachmentOwner = useMemo(
    () => ({ workspaceId: record.owner.ownerId, threadId }),
    [record.owner.ownerId, threadId],
  );
  const attachmentImagePort = useAgentTurnAttachmentImagePort(
    attachmentImages,
    onRevealAttachment ?? null,
    attachmentOwner,
  );
  const lightbox = useAgentAttachmentLightbox(attachmentImagePort, attachmentOwner);
  const attachmentImageViewer = lightbox.images;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const queueRef = useRef<HTMLDivElement | null>(null);
  const pinnedToLatestRef = useRef(true);
  const renderedTurnRef = useRef<{ readonly threadId: string; readonly turnId: string | null }>({
    threadId,
    turnId: null,
  });
  const hits = findHits ?? NO_FIND_HITS;
  const query = findQuery ?? "";
  const activeHit = findHitIndex === undefined ? null : (hits[findHitIndex] ?? null);
  const worktreeRemovalLabel = agentWorktreeRemovalLabel(thread);
  const provenanceNote = agentExternalOriginNote(record.externalOrigin);
  const markdown = useAgentMarkdownRenderer(markdownRenderer);
  const viewport = useMemo(() => {
    if (markdownViewport !== undefined) return markdownViewport;
    return createIntersectionAgentMarkdownViewport(() => scrollRef.current);
  }, [markdownViewport]);
  const followLatest = useCallback(() => {
    const container = scrollRef.current;
    if (container === null) return;
    if (!pinnedToLatestRef.current) return;
    container.scrollTop = container.scrollHeight;
  }, []);
  const prose = useMemo<AgentProseContext>(
    () => ({ markdown, openExternalLink, viewport, onParsed: followLatest }),
    [followLatest, markdown, openExternalLink, viewport],
  );

  const ownsViewport = markdownViewport === undefined;
  useEffect(() => {
    if (!ownsViewport) return;
    if (viewport === null) return;
    return () => viewport.dispose();
  }, [ownsViewport, viewport]);

  const hitTurnIds = useMemo(
    () => new Set(hits.filter((hit) => hit.scope === "turn").map((hit) => hit.turnId)),
    [hits],
  );
  const importedHighlights = useMemo(
    () => agentImportedHighlights(hits, findHitIndex, query),
    [findHitIndex, hits, query],
  );
  const baseHighlight = useMemo<AgentTurnHighlight>(() => ({ query, current: null }), [query]);
  const activeHighlight = useMemo<AgentTurnHighlight | null>(() => {
    if (findHitIndex === undefined) return null;
    const cursor = turnCursor(hits, findHitIndex);
    if (cursor === null) return null;
    return { query, current: cursor };
  }, [findHitIndex, hits, query]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const target = revealTarget(container, reveal, activeHit);
    if (target === null) return;
    const inset = findOpen ? `${AGENT_FIND_REVEAL_INSET}px` : "";
    target.element.style.scrollMarginTop = inset;
    target.element.scrollIntoView?.({ block: target.block });
    return () => {
      target.element.style.removeProperty("scroll-margin-top");
    };
  }, [activeHit, findOpen, reveal]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const updatePinnedState = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      pinnedToLatestRef.current = distanceFromBottom <= 32;
    };
    container.addEventListener("scroll", updatePinnedState, { passive: true });
    return () => container.removeEventListener("scroll", updatePinnedState);
  }, [threadId]);

  const lastTurn = record.turns[record.turns.length - 1] ?? null;
  const findInsetRef = useRef(0);
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const next = findOpen ? AGENT_FIND_REVEAL_INSET : 0;
    const previous = findInsetRef.current;
    if (next === previous) return;
    findInsetRef.current = next;
    if (pinnedToLatestRef.current) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    container.scrollTop = Math.max(0, container.scrollTop + next - previous);
  }, [findOpen]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const previous = renderedTurnRef.current;
    const newTurn = previous.threadId !== threadId || previous.turnId !== lastTurn?.turnId;
    renderedTurnRef.current = { threadId, turnId: lastTurn?.turnId ?? null };
    if (!newTurn && !pinnedToLatestRef.current) return;
    const before = container.scrollTop;
    container.scrollTop = container.scrollHeight;
    pinnedToLatestRef.current = true;
    if (container.scrollTop === before) return;
    viewport?.remeasure();
  }, [
    lastTurn?.events.length,
    lastTurn?.status.kind,
    lastTurn?.turnId,
    record.updatedAtEpochMs,
    record.externalOrigin?.history,
    threadId,
    viewport,
  ]);

  const [sessionElement, setSessionElement] = useState<HTMLElement | null>(null);
  const [turnListOpen, setTurnListOpen] = useState(false);
  const sessionWidth = useViewportWidth(sessionElement);
  const minimapSurface = agentMinimapHasPersistentGutter(sessionWidth) ? "rail" : "list";
  const minimapStripWidth = agentMinimapHitStripWidth(sessionWidth);
  const importedExchanges = record.externalOrigin?.history?.exchanges ?? NO_EXCHANGES;
  const importedTurns = useMemo(() => agentImportedTurns(importedExchanges), [importedExchanges]);
  const importedCarriesAttachments = useMemo(
    () => importedTurns.some((turn) => (turn.prompt?.attachments.length ?? 0) > 0),
    [importedTurns],
  );
  const minimap = useMemo(
    () => agentThreadMinimapModel(importedTurns, record.turns),
    [importedTurns, record.turns],
  );
  const measured = sessionElement !== null;
  const mapped = measured && minimap.entries.length >= MIN_AGENT_MINIMAP_ENTRIES;
  const inViewColumnKey = useAgentThreadTurnInView({
    columnSignature: `${importedTurns.length}:${record.turns.length}:${lastTurn?.turnId ?? ""}`,
    enabled: mapped && (minimapSurface === "rail" || turnListOpen),
    scrollRef,
    threadId,
  });
  const currentColumnIndex = agentMinimapEntryIndex(minimap, inViewColumnKey);
  const jumpToColumnEntry = useCallback((anchor: AgentThreadColumnAnchor): void => {
    const container = scrollRef.current;
    if (container === null) return;
    const entry = columnElement(container, anchor);
    if (entry === null) return;
    pinnedToLatestRef.current = false;
    entry.scrollIntoView?.({ block: "start" });
    entry.querySelector<HTMLElement>(".agent-prompt__bubble")?.focus({ preventScroll: true });
  }, []);

  const removeQueued = useCallback(
    (id: string): void => {
      onRemoveDeferredFollowUp?.(threadId, id);
    },
    [onRemoveDeferredFollowUp, threadId],
  );

  const editQueued = useCallback(
    (id: string): void => {
      onEditDeferredFollowUp?.(threadId, id);
    },
    [onEditDeferredFollowUp, threadId],
  );

  const revealQueue = useCallback((): void => {
    const queue = queueRef.current;
    const container = scrollRef.current;
    if (queue === null || container === null) return;
    pinnedToLatestRef.current = false;
    const inset = findOpen ? AGENT_FIND_REVEAL_INSET : 0;
    container.scrollTop = Math.max(
      0,
      container.scrollTop +
        queue.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        container.clientTop -
        inset,
    );
    queue.focus({ preventScroll: true });
  }, [findOpen]);

  const sendQueuedNow = useCallback(
    (id: string): void => {
      void onSendDeferredFollowUpNow?.(threadId, id);
    },
    [onSendDeferredFollowUpNow, threadId],
  );

  const highlightFor = (turnIdentity: string): AgentTurnHighlight | null => {
    if (query === "") return null;
    if (activeHit?.scope === "turn" && activeHit.turnId === turnIdentity) return activeHighlight;
    if (!hitTurnIds.has(turnIdentity)) return null;
    return baseHighlight;
  };

  return (
    <section
      aria-label={`Agent thread ${threadId}`}
      className="agent-session"
      data-find={findOpen ? "open" : undefined}
      ref={setSessionElement}
    >
      {findBar}

      {measured && (
        <AgentThreadMinimap
          currentIndex={currentColumnIndex}
          model={minimap}
          onJump={jumpToColumnEntry}
          onOpenChange={setTurnListOpen}
          openSignal={goToTurnSignal}
          stripWidth={minimapStripWidth}
          surface={minimapSurface}
        />
      )}

      <div className="agent-session__scroll" ref={scrollRef} tabIndex={-1}>
        <div className="agent-session__body">
          {record.turnsTruncated && (
            <p className="agent-note agent-note--warning">
              Earlier turns were dropped to bound memory.
            </p>
          )}

          {provenanceNote !== null && (
            <p className="agent-note agent-session__provenance">{provenanceNote}</p>
          )}

          {record.externalOrigin != null && (
            <AgentImportedHistory
              attachmentImages={importedCarriesAttachments ? attachmentImageViewer : null}
              highlights={importedHighlights}
              history={record.externalOrigin.history}
              key={`${threadId}:${record.externalOrigin.sessionId}`}
              onRetry={onRetryExternalHistory}
              prose={prose}
              state={externalHistoryState}
              textClipboard={textClipboard}
            />
          )}

          <AgentArtifactPreviewScope
            key={`${threadId}:${serverId ?? "local"}:${runnerId ?? record.owner.ownerId}`}
          >
            <div className="agent-turn-list">
              {record.turns.map((turn) => (
                <AgentTurnView
                  attachmentImages={
                    agentTurnCarriesAttachments(turn) ? attachmentImageViewer : null
                  }
                  artifactScope={artifactScope}
                  highlight={highlightFor(turn.turnId)}
                  key={turn.turnId}
                  prose={prose}
                  provider={record.provider.kind}
                  executionTarget={thread.execution?.kind ?? "local"}
                  renderProbe={turnRenderProbe}
                  textClipboard={textClipboard}
                  turn={turn}
                  workspaceRoot={record.target.worktreePath ?? record.owner.repositoryRoot}
                />
              ))}
            </div>
          </AgentArtifactPreviewScope>

          {deferredFollowUps.length > 0 && (
            <div
              className="agent-queued-list"
              role="region"
              aria-label="Pending messages"
              ref={queueRef}
              tabIndex={-1}
            >
              {deferredFollowUps.some((entry) => entry.state === "paused") &&
                onResumeDeferredFollowUps !== undefined && (
                  <div className="agent-queued-list__controls">
                    <button
                      aria-label="Resume queued messages"
                      className="agent-prompt__queue-action agent-prompt__queue-action--resume"
                      onClick={() => void onResumeDeferredFollowUps(threadId)}
                      title="Resume queued messages"
                      type="button"
                    >
                      <Play aria-hidden="true" />
                      Resume
                    </button>
                  </div>
                )}
              {deferredFollowUps.map((entry) => (
                <AgentQueuedPrompt
                  attachments={entry.request.attachments}
                  displayAttachmentCount={entry.displayAttachmentCount}
                  id={entry.id}
                  key={entry.id}
                  onEdit={onEditDeferredFollowUp === undefined ? undefined : editQueued}
                  onRemove={removeQueued}
                  onSendNow={onSendDeferredFollowUpNow === undefined ? undefined : sendQueuedNow}
                  state={entry.state}
                  prompt={entry.request.prompt}
                />
              ))}
            </div>
          )}

          {thread.worktreeMissing && (
            <p className="agent-note agent-note--warning">
              The worktree for this thread no longer exists.
            </p>
          )}

          {worktreeRemovalLabel !== null && <p className="agent-note">{worktreeRemovalLabel}</p>}

          {thread.changeSummary && (
            <AgentThreadChangesCue
              onReviewInDiff={onReviewInDiff}
              summary={thread.changeSummary}
              threadId={threadId}
            />
          )}
        </div>
      </div>

      {deferredFollowUps.length > 0 && (
        <div className="agent-session__queue-summary">
          <button
            aria-label={`Show ${deferredFollowUps.length} queued ${deferredFollowUps.length === 1 ? "message" : "messages"}`}
            className="agent-prompt__queue-action agent-session__queue-count"
            onClick={revealQueue}
            title="Show pending messages, including paused messages"
            type="button"
          >
            <Clock3 aria-hidden="true" />
            {deferredFollowUps.length} queued
          </button>
        </div>
      )}

      <AgentAttachmentLightbox
        entry={lightbox.entry}
        images={attachmentImageViewer}
        onClose={lightbox.close}
        onSelect={lightbox.select}
      />
    </section>
  );
}

const AgentTurnView = memo(function AgentTurnView({
  artifactScope = null,
  attachmentImages = null,
  highlight = null,
  executionTarget,
  prose,
  provider,
  renderProbe,
  textClipboard,
  turn,
  workspaceRoot = null,
}: {
  readonly artifactScope?: AgentArtifactScope | null;
  readonly attachmentImages?: AgentTurnAttachmentImageViewer | null;
  readonly highlight?: AgentTurnHighlight | null;
  readonly prose: AgentProseContext;
  readonly provider: AgentCliKind;
  readonly executionTarget: "local" | "remote";
  readonly renderProbe?: (turnId: string) => void;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentTurn;
  readonly workspaceRoot?: string | null;
}) {
  renderProbe?.(turn.turnId);
  const attachments = useMemo(() => agentTurnAttachmentViews(turn.attachments), [turn.attachments]);
  const revealEventIndex =
    highlight?.current?.kind === "event" ? highlight.current.eventIndex : null;
  const settlement = agentTurnSettlement(turn.status);
  const projection = useMemo(
    () => agentTurnProjection(turn.events, revealEventIndex, workspaceRoot, settlement),
    [turn.events, revealEventIndex, workspaceRoot, settlement],
  );
  const subagents = useMemo(() => agentTurnSubagentSummary(turn.events), [turn.events]);
  const running = settlement === "running";
  const [streamed, setStreamed] = useState(running);

  useEffect(() => {
    if (!running) return;
    if (streamed) return;
    setStreamed(true);
  }, [running, streamed]);

  const stream = proseStream(running, streamed);
  const errorContext = createTurnErrorContext(
    provider,
    turn.cliVersion,
    executionTarget,
    projection.items,
  );
  const rawLines = projection.rawLines.filter(
    (line) => !isAgentRawOutputNoise(provider, line.stream, line.raw),
  );
  const empty = projection.items.length === 0 && rawLines.length === 0;
  const workFold = agentTurnWorkFold(projection.items, running);
  const liveActivity = agentTurnLiveActivity(turn);
  const compaction = agentCompactionState(provider, turn);
  const compacting = compaction.kind === "compacting";
  const toolDisclosure = useAgentTurnToolDisclosure();
  const liveStatus =
    compacting || liveActivity === null || empty ? null : (
      <AgentTurnLiveStatus activity={liveActivity} items={projection.items} />
    );
  const cursor = highlight?.current ?? null;
  const promptCurrent = cursor !== null && cursor.kind === "prompt" ? cursor.occurrence : null;
  const rawDisclosed = rawOutputDisclosed(turn.status);
  const rawOutput =
    rawLines.length === 0 || !rawDisclosed ? null : <AgentRawOutput lines={rawLines} />;
  const failure = turnFailure(turn.status, errorContext);
  const threadUsage = turn.events.reduce<import("../../domain/agentThread").AgentTurnUsage | null>(
    (latest, event) =>
      event.kind === "result" && event.usage?.scope === "thread" ? event.usage : latest,
    null,
  );

  return (
    <AgentToolDisclosureContext.Provider value={toolDisclosure}>
      <article
        aria-label={`Agent turn ${turn.turnId}`}
        className="agent-turn"
        data-agent-column={agentThreadColumnKey({ scope: "turn", turnId: turn.turnId })}
        data-agent-turn={turn.turnId}
      >
        <AgentTurnPrompt
          attachmentImages={attachmentImages}
          attachments={attachments}
          current={promptCurrent}
          prompt={turn.prompt}
          query={highlight?.query ?? ""}
          textClipboard={textClipboard}
        />

        <div className="agent-answer">
          <AgentTurnHead
            provider={provider}
            startedAtEpochMs={turn.startedAtEpochMs}
            timing={agentTurnTiming(turn)}
          />

          {turn.status.kind === "pending" && provider === "codex" && !compacting && (
            <p className="agent-note" role="status">
              Starting Codex…
            </p>
          )}
          <AgentThreadUsage usage={threadUsage} />
          {projection.hiddenCount > 0 && (
            <p className="agent-note">{projection.hiddenCount} events hidden</p>
          )}

          <div className="agent-turn__events">
            {subagents !== null && <AgentSubagentBanner summary={subagents} />}
            {workFold === null && subagents !== null && (
              <AgentSubagentList entries={subagents.entries} />
            )}
            {workFold !== null && (
              <AgentTurnWork
                compacting={compacting}
                liveStatus={liveStatus}
                attachmentImages={attachmentImages}
                errorContext={errorContext}
                highlight={highlight}
                items={workFold.workItems}
                key={running ? "running-work" : "settled-work"}
                prose={prose}
                running={running}
                stream={stream}
                subagents={subagents}
                summary={workFold.summary}
                textClipboard={textClipboard}
                turn={turn}
              />
            )}
            {(workFold?.visibleItems ?? projection.items)
              .filter((item) => !isAgentSubagentToolItem(item))
              .map((item) => (
                <AgentTurnItemView
                  attachmentImages={attachmentImages}
                  errorContext={errorContext}
                  highlight={itemHighlight(highlight, item.key)}
                  groupHighlight={highlight}
                  item={item}
                  key={item.key}
                  prose={prose}
                  stream={stream}
                  textClipboard={textClipboard}
                />
              ))}
            {workFold === null && liveStatus}
            {compaction.kind === "failed" && (
              <p className="agent-note agent-note--warning" role="status">
                Context compaction failed{compaction.message ? `: ${compaction.message}` : "."}
              </p>
            )}
            {compacting && (
              <p className="agent-note" role="status">
                Compacting context…
                <span aria-hidden="true" className="agent-well__caret" />
              </p>
            )}
            {empty &&
              running &&
              compaction.kind === "idle" &&
              !(turn.status.kind === "pending" && provider === "codex") && (
                <p className="agent-note">
                  Waiting for output…
                  <span aria-hidden="true" className="agent-well__caret" />
                </p>
              )}
          </div>

          {!running && artifactScope !== null && (
            <AgentTurnArtifacts scope={artifactScope} turn={turn} />
          )}

          {rawOutput !== null && <div className="agent-message-actions">{rawOutput}</div>}

          {turn.eventsTruncated && (
            <p className="agent-note agent-note--warning">
              Some output is not included in this view.
            </p>
          )}

          {turn.status.kind === "interrupted" && (
            <p className="agent-note agent-note--warning">Interrupted by app restart</p>
          )}

          {failure !== null && !repeatsLastError(failure, projection.items, errorContext) && (
            <section className="agent-finale agent-finale--bad">
              <span className="agent-microlabel agent-microlabel--bad">run failed</span>
              <p className="agent-finale__body">
                {agentProviderErrorHeadline(failure, errorContext.installedVersion)}
              </p>
              <AgentProviderErrorHint error={failure} context={errorContext} />
            </section>
          )}
        </div>
      </article>
    </AgentToolDisclosureContext.Provider>
  );
});

function AgentRawOutput({ lines }: { readonly lines: ReadonlyArray<AgentRawLine> }) {
  return (
    <details className="agent-raw" open>
      <summary className="agent-raw__toggle">Raw output</summary>
      <pre className="agent-raw__lines">{lines.map((line) => line.raw).join("\n")}</pre>
    </details>
  );
}

function AgentTurnWork({
  compacting,
  attachmentImages,
  errorContext,
  highlight,
  items,
  liveStatus,
  prose,
  running,
  stream,
  subagents,
  summary,
  textClipboard,
  turn,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentTurnHighlight | null;
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly liveStatus: ReactNode;
  readonly prose: AgentProseContext;
  readonly compacting: boolean;
  readonly running: boolean;
  readonly stream: AgentProseStream;
  readonly subagents: AgentSubagentSummary | null;
  readonly summary: string;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentTurn;
}) {
  const title = running ? (
    <>
      {compacting ? "Turn elapsed " : "Working for "}
      <AgentWorkingDuration startedAtEpochMs={turn.startedAtEpochMs} />
    </>
  ) : (
    <>
      Worked for{" "}
      {agentTurnDurationLabel(
        (turn.endedAtEpochMs ?? turn.startedAtEpochMs) - turn.startedAtEpochMs,
      )}
    </>
  );
  return (
    <details className="agent-work" open={running || undefined}>
      <summary className="agent-work__summary">
        <span className="agent-work__title">{title}</span>
        <span className="agent-work__counts">{summary}</span>
        <ChevronDown aria-hidden="true" className="agent-work__chevron" size={14} />
      </summary>
      <div className="agent-work__events">
        {subagents !== null && <AgentSubagentList entries={subagents.entries} />}
        {items
          .filter((item) => !isAgentSubagentToolItem(item))
          .map((item) => (
            <AgentTurnItemView
              attachmentImages={attachmentImages}
              errorContext={errorContext}
              highlight={itemHighlight(highlight, item.key)}
              groupHighlight={highlight}
              item={item}
              key={item.key}
              prose={prose}
              stream={stream}
              textClipboard={textClipboard}
            />
          ))}
        {liveStatus}
      </div>
    </details>
  );
}

function AgentSubagentList({ entries }: { readonly entries: ReadonlyArray<AgentSubagentEntry> }) {
  return (
    <ul aria-label="Subagents" className="agent-subagent-list">
      {entries.map((entry) => (
        <li className="agent-subagent" key={entry.toolId}>
          <span className="agent-subagent__name">{entry.name}</span>
          <span className="agent-subagent__description">{entry.description}</span>
          <span className={`agent-subagent__state agent-subagent__state--${entry.state}`}>
            {subagentStateLabel(entry.state)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function subagentStateLabel(state: AgentSubagentEntry["state"]): string {
  if (state === "running") return "working";
  if (state === "failed") return "failed";
  return "completed";
}

function AgentSubagentBanner({ summary }: { readonly summary: AgentSubagentSummary }) {
  const states = [
    summary.running > 0 ? `${summary.running} working` : null,
    summary.completed > 0 ? `${summary.completed} completed` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
  ].filter((state): state is string => state !== null);
  return (
    <div className="agent-subagents" role="status">
      <span
        aria-hidden="true"
        className={`agent-subagents__dot${summary.running > 0 ? " agent-subagents__dot--live" : ""}${summary.failed > 0 && summary.running === 0 ? " agent-subagents__dot--failed" : ""}`}
      />
      <span className="agent-subagents__label">
        Started {summary.total} subagent{summary.total === 1 ? "" : "s"}
      </span>
      <span className="agent-subagents__status">{states.join(" · ")}</span>
    </div>
  );
}

interface AgentTurnItemViewProps {
  readonly groupHighlight?: AgentTurnHighlight | null;
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentItemHighlight | null;
  readonly item: AgentTurnItem;
  readonly prose: AgentProseContext;
  readonly stream: AgentProseStream;
  readonly textClipboard: TextClipboardGateway | null;
}

function AgentTurnItemView({
  groupHighlight = null,
  attachmentImages,
  errorContext,
  highlight,
  item,
  prose,
  stream,
  textClipboard,
}: AgentTurnItemViewProps) {
  if (item.kind === "subagentGroup") {
    const group = item.group;
    const cursor = groupHighlight?.current;
    const childIndex =
      cursor?.kind === "event" ? group.sourceOffsets.indexOf(cursor.eventIndex) : -1;
    const childHighlight: AgentTurnHighlight | null =
      groupHighlight === null
        ? null
        : {
            query: groupHighlight.query,
            current:
              childIndex < 0 || cursor?.kind !== "event"
                ? null
                : {
                    kind: "event",
                    eventIndex: childIndex,
                    occurrence: cursor.occurrence,
                  },
          };
    const childProjection = agentTurnProjection(group.events, childIndex < 0 ? null : childIndex);
    const childHiddenCount = group.hiddenCount + childProjection.hiddenCount;
    return (
      <details
        className="agent-reasoning"
        data-agent-event={item.key}
        open={childIndex >= 0 || undefined}
      >
        <summary className="agent-microlabel">
          {group.path} · {group.state}
          {group.durationMs !== null && ` · ${agentTurnDurationLabel(group.durationMs)}`}
        </summary>
        <AgentThreadUsage usage={group.usage} />
        {childHiddenCount > 0 && (
          <p className="agent-note">{childHiddenCount} subagent events hidden</p>
        )}
        {childProjection.items.map((child) => (
          <AgentTurnItemView
            key={child.key}
            item={child}
            attachmentImages={null}
            errorContext={errorContext}
            highlight={itemHighlight(childHighlight, child.key)}
            groupHighlight={childHighlight}
            prose={prose}
            stream={stream}
            textClipboard={textClipboard}
          />
        ))}
      </details>
    );
  }
  if (item.kind === "queued")
    return (
      <p className="agent-note" data-agent-event={item.key}>
        <span className="agent-prompt__chip agent-prompt__chip--queued">Queued</span> Message
        accepted for the next turn.
      </p>
    );
  if (item.kind === "userMessage") {
    return (
      <AgentSteeredMessage
        attachmentImages={attachmentImages}
        highlight={highlight}
        item={item}
        textClipboard={textClipboard}
      />
    );
  }

  if (item.kind === "assistantText") {
    return (
      <AgentAssistantText
        eventKey={item.key}
        current={highlight?.current ?? null}
        prose={prose}
        query={highlight?.query ?? ""}
        stream={stream}
        text={item.text}
        textClipboard={textClipboard}
      />
    );
  }

  if (item.kind === "reasoning") {
    return (
      <details className="agent-reasoning">
        <summary className="agent-microlabel">reasoning</summary>
        <p className="agent-reasoning__body">{item.text}</p>
      </details>
    );
  }

  if (item.kind === "tool") {
    return <AgentToolRow item={item} />;
  }

  if (item.kind === "result") {
    const error = item.isError
      ? classifyAgentProviderError(item.text, errorContext.provider)
      : null;
    if (error !== null && suppressGenericFailure(error, errorContext)) return null;
    const text =
      error === null ? item.text : agentProviderErrorHeadline(error, errorContext.installedVersion);
    return (
      <section
        className={item.isError ? "agent-finale agent-finale--bad" : "agent-finale"}
        data-agent-event={item.key}
      >
        <span
          className={item.isError ? "agent-microlabel agent-microlabel--bad" : "agent-microlabel"}
        >
          {item.isError ? "run failed" : "result"}
        </span>
        {text !== "" && (
          <p className="agent-finale__body">
            <HighlightRun
              current={highlight?.current ?? null}
              query={highlight?.query ?? ""}
              text={text}
            />
          </p>
        )}
        {error !== null && <AgentProviderErrorHint error={error} context={errorContext} />}
        {text !== "" && (
          <div className="agent-message-actions">
            <AgentMessageCopyButton clipboard={textClipboard} label="AI response" text={text} />
          </div>
        )}
      </section>
    );
  }

  if (item.kind === "contextCompaction") {
    const tokenChange =
      item.beforeTokens === null || item.afterTokens === null
        ? null
        : `${formatTokens(item.beforeTokens)} → ${formatTokens(item.afterTokens)} tokens`;
    return (
      <div className="agent-compaction-event" data-agent-event={item.key}>
        <span>Conversation compacted</span>
        {tokenChange !== null && <span className="agent-num">{tokenChange}</span>}
      </div>
    );
  }

  const error = classifyAgentProviderError(item.message, errorContext.provider);

  if (suppressGenericFailure(error, errorContext)) return null;
  if (error.detail.kind === "advisory") {
    return (
      <p className="agent-note" data-agent-event={item.key}>
        {error.detail.text}
      </p>
    );
  }

  return (
    <section className="agent-finale agent-finale--bad" data-agent-event={item.key}>
      <span className="agent-microlabel agent-microlabel--bad">error</span>
      <p className="agent-finale__body">
        {agentProviderErrorHeadline(error, errorContext.installedVersion)}
      </p>
      <AgentProviderErrorHint error={error} context={errorContext} />
    </section>
  );
}

function AgentSteeredMessage({
  attachmentImages,
  highlight,
  item,
  textClipboard,
}: {
  readonly attachmentImages: AgentTurnAttachmentImageViewer | null;
  readonly highlight: AgentItemHighlight | null;
  readonly item: Extract<AgentTurnItem, { kind: "userMessage" }>;
  readonly textClipboard: TextClipboardGateway | null;
}) {
  const attachments = useMemo(() => agentTurnAttachmentViews(item.attachments), [item.attachments]);

  return (
    <AgentTurnPrompt
      attachmentImages={attachments.length === 0 ? null : attachmentImages}
      attachments={attachments}
      current={highlight?.current ?? null}
      eventKey={item.key}
      prompt={item.text}
      query={highlight?.query ?? ""}
      role="steer"
      textClipboard={textClipboard}
    />
  );
}

function proseStream(running: boolean, streamed: boolean): AgentProseStream {
  if (running) return "streaming";
  if (streamed) return "streamed";
  return "settled";
}

function AgentProviderErrorHint({
  error,
  context,
}: {
  readonly error: AgentProviderError;
  readonly context: AgentTurnErrorContext;
}): ReactNode {
  if (error.detail.kind !== "unsupportedModelForCliVersion") return null;

  return (
    <>
      <p className="agent-note">
        {context.executionTarget === "remote"
          ? "Update the CLI on the server running this thread, then try again."
          : "Open Settings > Agents to update it."}
      </p>
      <details className="agent-raw">
        <summary className="agent-raw__toggle">Provider message</summary>
        <pre className="agent-raw__lines">{error.raw}</pre>
      </details>
    </>
  );
}

function rawOutputDisclosed(status: AgentTurnStatus): boolean {
  if (status.kind === "failed") return true;
  if (status.kind === "interrupted") return true;

  return status.kind === "exited" && status.exitCode !== 0;
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
}

function toolRowIcon(kind: AgentToolRowKind): LucideIcon {
  switch (kind) {
    case "command":
      return Terminal;
    case "read":
      return FileText;
    case "edit":
      return SquarePen;
    case "search":
      return Search;
    case "agent":
      return Bot;
    case "web":
      return Globe;
    case "other":
      return Wrench;
    default:
      return unsupportedToolRowKind(kind);
  }
}

function toolRowClassName(status: AgentToolRowStatus): string {
  switch (status) {
    case "running":
      return "agent-tool-row agent-tool-row--running";
    case "error":
      return "agent-tool-row agent-tool-row--failed";
    case "stopped":
      return "agent-tool-row agent-tool-row--stopped";
    case "ok":
      return "agent-tool-row";
    default:
      return unsupportedToolRowStatus(status);
  }
}

function unsupportedToolRowStatus(status: never): never {
  throw new TypeError(`Unsupported agent tool row status: ${String(status)}.`);
}

interface AgentToolDisclosure {
  readonly expanded: ReadonlySet<string>;
  readonly toggle: (toolId: string) => void;
}

const AgentToolDisclosureContext = createContext<AgentToolDisclosure | null>(null);

function useAgentToolDisclosure(toolId: string): {
  readonly expanded: boolean;
  readonly toggle: () => void;
} {
  const shared = useContext(AgentToolDisclosureContext);
  const [local, setLocal] = useState(false);
  const toggleLocal = useCallback(() => setLocal((open) => !open), []);
  const toggleShared = useCallback(() => shared?.toggle(toolId), [shared, toolId]);
  if (shared === null) return { expanded: local, toggle: toggleLocal };
  return { expanded: shared.expanded.has(toolId), toggle: toggleShared };
}

function useAgentTurnToolDisclosure(): AgentToolDisclosure {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const toggle = useCallback((toolId: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.delete(toolId)) return next;
      next.add(toolId);
      return next;
    });
  }, []);
  return useMemo(() => ({ expanded, toggle }), [expanded, toggle]);
}

function AgentToolRow({ item }: { readonly item: Extract<AgentTurnItem, { kind: "tool" }> }) {
  const disclosure = useAgentToolDisclosure(item.toolId);
  const detailId = useId();
  const Icon = toolRowIcon(item.rowKind);
  const expanded = disclosure.expanded;

  return (
    <>
      <button
        aria-controls={detailId}
        aria-expanded={expanded}
        aria-live="off"
        className={toolRowClassName(item.status)}
        onClick={disclosure.toggle}
        type="button"
      >
        <Icon aria-hidden="true" className="agent-tool-row__icon" size={15} />
        <span className="agent-tool-row__label">{item.label}</span>
        {item.argument !== null && (
          <span className="agent-tool-row__argument">{item.argument}</span>
        )}
      </button>
      <div className="agent-tool-row__detail" hidden={!expanded} id={detailId}>
        {expanded && <AgentToolRowDetail item={item} />}
      </div>
    </>
  );
}

function AgentToolRowDetail({ item }: { readonly item: Extract<AgentTurnItem, { kind: "tool" }> }) {
  return (
    <>
      {item.command !== null && (
        <pre className="agent-tool-row__command">{`$ ${item.command}`}</pre>
      )}
      {item.output !== null && <pre className="agent-tool-row__output">{item.output}</pre>}
      {item.output === null && <p className="agent-tool-row__empty">No output</p>}
    </>
  );
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

function AgentThreadSessionEmpty({ repositoryLabel }: { readonly repositoryLabel: string | null }) {
  return (
    <section aria-label="New agent thread" className="agent-session">
      <div className="agent-session__scroll">
        <div className="agent-session__body agent-session__body--empty">
          <AgentEmptyTitle repositoryLabel={repositoryLabel} />
        </div>
      </div>
    </section>
  );
}

function AgentEmptyTitle({ repositoryLabel }: { readonly repositoryLabel: string | null }) {
  if (repositoryLabel === null) {
    return (
      <>
        <h2 className="agent-empty__title">No Git repository detected</h2>
        <p className="agent-empty__text">
          The agent will work in this folder as it is. Open a Git repository to get branches,
          worktrees and change review.
        </p>
      </>
    );
  }

  return (
    <h2 className="agent-empty__title">
      What should we build in <span className="agent-empty__project">{repositoryLabel}</span>?
    </h2>
  );
}

function itemHighlight(
  highlight: AgentTurnHighlight | null,
  key: string,
): AgentItemHighlight | null {
  if (highlight === null || highlight.query === "") return null;
  const eventIndex = Number.parseInt(key.slice(1), 10);
  const cursor = highlight.current;
  if (cursor === null || cursor.kind !== "event" || cursor.eventIndex !== eventIndex) {
    return { query: highlight.query, current: null };
  }
  return { query: highlight.query, current: cursor.occurrence };
}

function turnCursor(
  hits: ReadonlyArray<AgentThreadFindHit>,
  index: number,
): AgentTurnHighlightCursor | null {
  const hit = hits[index];
  if (hit === undefined) return null;

  if (hit.scope !== "turn") return null;

  let occurrence = 0;
  for (let position = 0; position < index; position += 1) {
    const other = hits[position];
    if (other === undefined) continue;
    if (other.scope !== "turn") continue;
    if (other.turnId !== hit.turnId) continue;
    if (other.eventIndex !== hit.eventIndex) continue;
    occurrence += 1;
  }

  if (hit.eventIndex === null) return { kind: "prompt", occurrence };
  return { kind: "event", eventIndex: hit.eventIndex, occurrence };
}

function revealTarget(
  container: HTMLElement,
  reveal: AgentThreadRevealRequest | null,
  activeHit: AgentThreadFindHit | null,
): AgentRevealTarget | null {
  const current = container.querySelector<HTMLElement>(".agent-find__hit--current");
  if (current !== null) return { element: current, block: "center" };

  const turnHit = activeHit === null || activeHit.scope !== "turn" ? null : activeHit;
  const turnId = reveal?.turnId ?? turnHit?.turnId ?? null;
  if (turnId === null) {
    const imported = importedElement(container, activeHit);
    return imported === null ? null : { element: imported, block: "start" };
  }

  const turn = turnElement(container, turnId);
  if (turn === null) return null;

  const eventIndex = reveal?.eventIndex ?? turnHit?.eventIndex ?? null;
  if (eventIndex === null) return { element: turn, block: "start" };

  const event = eventElement(turn, eventIndex);
  if (event === null) return { element: turn, block: "start" };

  return { element: event, block: "start" };
}

function importedElement(
  container: HTMLElement,
  activeHit: AgentThreadFindHit | null,
): HTMLElement | null {
  if (activeHit === null) return null;
  if (activeHit.scope !== "imported") return null;

  return container.querySelector<HTMLElement>(`[data-agent-event="x${activeHit.exchangeIndex}"]`);
}

function columnElement(
  container: HTMLElement,
  anchor: AgentThreadColumnAnchor,
): HTMLElement | null {
  const key = agentThreadColumnKey(anchor);
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-column]"));
  return candidates.find((candidate) => candidate.dataset.agentColumn === key) ?? null;
}

function turnElement(container: HTMLElement, turnId: string): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-turn]"));
  return candidates.find((candidate) => candidate.dataset.agentTurn === turnId) ?? null;
}

function eventElement(turn: HTMLElement, eventIndex: number): HTMLElement | null {
  const key = `e${eventIndex}`;
  const candidates = Array.from(turn.querySelectorAll<HTMLElement>("[data-agent-event]"));
  return candidates.find((candidate) => candidate.dataset.agentEvent === key) ?? null;
}
