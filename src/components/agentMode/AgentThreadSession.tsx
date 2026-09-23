import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import { AgentThreadSessionEmpty } from "./AgentThreadSessionEmpty";
import { AgentHistoryActivity } from "./AgentHistoryActivity";
import { AgentHistoryPager } from "./AgentHistoryPager";
import type { AgentThreadHistorySurface } from "../../application/useAgentThreadHistory";
import { AgentAgentsDock } from "./AgentAgentsDock";
import { AgentBackgroundWorkBanner } from "./AgentBackgroundWorkBanner";
import { useAgentThreadAgents } from "./useAgentThreadAgents";
import type { AgentTurnLogFactsSource } from "../../application/agentTurnLogStatusStore";
import { AgentArtifactPreviewScope } from "./AgentOutputArtifacts";
import type {
  AgentArtifactLoader,
  AgentArtifactPreviewPort,
} from "../../application/agentArtifactPorts";
import type { AgentArtifactScope } from "./AgentTurnArtifacts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Clock3, Play } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { DeferredFollowUp } from "../../application/agentDeferredFollowUps";
import type { AgentAttachmentImagesSurface } from "../../application/useAgentAttachmentImages";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type {
  ExternalAgentSessionHistory,
  ExternalSessionExchange,
} from "../../domain/externalAgentSession";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { agentExternalOriginNote, type AgentThreadRevealRequest } from "./agentSidebarPresentation";
import { AgentRecordedTurnChanges } from "./AgentRecordedTurnChanges";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type { MonacoAppTheme } from "../../domain/settings";
import { isTerminalAgentTurnStatus } from "../../domain/agentThread";
import { AgentImportedHistory, type AgentExternalHistoryState } from "./AgentImportedHistory";
import { AgentQueuedPrompt } from "./AgentQueuedPrompt";
import { AgentAttachmentLightbox } from "./AgentAttachmentLightbox";
import { useAgentAttachmentLightbox } from "./useAgentAttachmentLightbox";
import { useAgentTurnAttachmentImagePort } from "./useAgentTurnAttachmentImages";
import type { AgentProseContext } from "./AgentAssistantText";
import {
  agentLocalFileLinkScope,
  openAgentMarkdownLink,
  type AgentExternalLinkOpener,
  type AgentLocalFileLinkPort,
} from "./agentMarkdownLinks";
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
import { useAgentMarkdownRenderer } from "./useAgentMarkdown";
import { createIntersectionAgentMarkdownViewport } from "../../infrastructure/viewport/intersectionAgentMarkdownViewport";
import { agentTurnCarriesAttachments, agentWorktreeRemovalLabel } from "./agentModePresentation";
import {
  agentTurnHydrationScrollTop,
  agentTurnItemKey,
  normalizeAgentTurnEventOffset,
} from "./agentTurnItemKeys";
import type { AgentTurnHighlight, AgentTurnHighlightCursor } from "./agentTurnHighlightModel";
import { AgentTurnView } from "./AgentTurnView";
import { AgentJumpToLatest } from "./AgentJumpToLatest";
import { useAgentThreadFollow } from "./useAgentThreadFollow";
import { AgentCodeColorizerContext, type AgentCodeColorizer } from "./agentCodeColorizer";
import { defaultAgentCodeColorizer } from "./shikiAgentCodeColorizer";

const NO_FIND_HITS: ReadonlyArray<AgentThreadFindHit> = [];
const NO_DEFERRED_FOLLOW_UPS: ReadonlyArray<DeferredFollowUp> = [];
const NO_EXCHANGES: ReadonlyArray<ExternalSessionExchange> = [];

export const AGENT_FIND_REVEAL_INSET = 34;

interface AgentRevealTarget {
  readonly element: HTMLElement;
  readonly block: "start" | "center";
}

export interface AgentThreadSessionProps {
  readonly history?: AgentThreadHistorySurface;
  readonly importedHistory?: ExternalAgentSessionHistory;
  readonly hasEarlierImportedHistory?: boolean;
  readonly onEarlierImportedHistory?: () => void;
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
  readonly localFileLinks?: AgentLocalFileLinkPort | null;
  readonly externalHistoryState?: AgentExternalHistoryState;
  readonly attachmentImages?: AgentAttachmentImagesSurface | null;
  readonly onRevealAttachment?: (threadId: string, attachmentId: string) => void;
  readonly onRetryExternalHistory?: () => void;
  readonly turnLog?: AgentTurnLogFactsSource | null;
  onReviewInDiff(threadId: string): void;
  onStopBackground?(): void;
  readonly onOpenTurnDiff?: (
    threadId: string,
    summary: AgentTurnChangeSummary,
    relativePath?: string,
  ) => void;
  readonly turnChangesRevision?: object;
  readonly getTurnChanges?: AgentThreadsSurface["getTurnChanges"];
  readonly monacoTheme?: MonacoAppTheme;
  readonly codeColorizer?: AgentCodeColorizer | null;
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
  history,
  importedHistory,
  hasEarlierImportedHistory = false,
  onEarlierImportedHistory,
  artifactLoader = null,
  artifactPreview = null,
  attachmentImages = null,
  deferredFollowUps = NO_DEFERRED_FOLLOW_UPS,
  onRemoveDeferredFollowUp,
  onEditDeferredFollowUp,
  onResumeDeferredFollowUps,
  onSendDeferredFollowUpNow,
  onRevealAttachment,
  onStopBackground,
  findBar = null,
  findHitIndex,
  findHits,
  findOpen = false,
  findQuery,
  goToTurnSignal = 0,
  onOpenTurnDiff,
  turnChangesRevision,
  getTurnChanges,
  monacoTheme = "calm-dark",
  codeColorizer,
  reveal = null,
  textClipboard = null,
  markdownRenderer,
  markdownViewport,
  openExternalLink = openAgentMarkdownLink,
  localFileLinks = null,
  externalHistoryState,
  onRetryExternalHistory,
  thread,
  turnLog = null,
  turnRenderProbe,
}: AgentThreadSessionBodyProps) {
  const record = thread.thread;
  const threadId = record.threadId;
  const displayedImportedHistory = importedHistory ?? record.externalOrigin?.history;
  const historyPage = history?.page?.threadId === threadId ? history.page : null;
  const displayedTurns = historyPage?.turns ?? record.turns;
  const agents = useAgentThreadAgents(threadId, displayedTurns);
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
  const lastTurn = displayedTurns[displayedTurns.length - 1] ?? null;
  const lastEventCount = lastTurn?.events.length ?? 0;
  const lastStatusKind = lastTurn?.status.kind ?? null;
  const updatedAtEpochMs = record.updatedAtEpochMs;
  const contentRevision = useMemo(
    () => ({ lastEventCount, lastStatusKind, displayedImportedHistory, updatedAtEpochMs }),
    [displayedImportedHistory, lastEventCount, lastStatusKind, updatedAtEpochMs],
  );
  const queuedPrompts = useMemo(
    () => deferredFollowUps.map((entry) => entry.request.prompt),
    [deferredFollowUps],
  );
  const follow = useAgentThreadFollow({
    scrollRef,
    threadId,
    pageKey:
      historyPage === null ? null : `${historyPage.threadId}:${historyPage.turns[0]?.turnId ?? ""}`,
    lastTurn,
    contentRevision,
    queuedPrompts,
    viewport,
  });
  const { followLatest, pinnedRef: pinnedToLatestRef, release: releaseLatest } = follow;
  const colorizer = useMemo(
    () => (codeColorizer === undefined ? defaultAgentCodeColorizer(monacoTheme) : codeColorizer),
    [codeColorizer, monacoTheme],
  );
  const remoteExecution = thread.execution?.kind === "remote";
  const localFiles = useMemo(
    () =>
      agentLocalFileLinkScope(localFileLinks, {
        remote: remoteExecution,
        repositoryRoot: record.owner.repositoryRoot,
        worktreePath: record.target.worktreePath,
      }),
    [localFileLinks, record.owner.repositoryRoot, record.target.worktreePath, remoteExecution],
  );
  const prose = useMemo<AgentProseContext>(
    () => ({ markdown, openExternalLink, localFiles, viewport, onParsed: followLatest }),
    [followLatest, localFiles, markdown, openExternalLink, viewport],
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

  const liveTurn = record.turns[record.turns.length - 1] ?? null;
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
  }, [findOpen, pinnedToLatestRef]);

  const turnEventOffsets = useMemo(
    () =>
      displayedTurns.map((entry) => ({
        turnId: entry.turnId,
        offset: normalizeAgentTurnEventOffset(entry.firstEventOffset),
      })),
    [displayedTurns],
  );
  const scrollHeightRef = useRef(0);
  const hydratedOffsetsRef = useRef({ threadId, offsets: turnEventOffsets });
  useLayoutEffect(() => {
    const previous = hydratedOffsetsRef.current;
    hydratedOffsetsRef.current = { threadId, offsets: turnEventOffsets };
    const container = scrollRef.current;
    if (container === null) return;
    if (pinnedToLatestRef.current) return;
    if (previous.threadId !== threadId) return;
    const shifted = prependedTurnIds(previous.offsets, turnEventOffsets);
    if (shifted.length === 0) return;
    const insertionTops = turnInsertionTops(container, shifted);
    if (insertionTops === null) return;
    const anchored = agentTurnHydrationScrollTop({
      clientHeight: container.clientHeight,
      insertionTops,
      previousScrollHeight: scrollHeightRef.current,
      scrollHeight: container.scrollHeight,
      scrollTop: container.scrollTop,
    });
    if (anchored === null) return;
    container.scrollTop = anchored;
  }, [pinnedToLatestRef, threadId, turnEventOffsets]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    scrollHeightRef.current = container.scrollHeight;
  });

  const [sessionElement, setSessionElement] = useState<HTMLElement | null>(null);
  const [turnListOpen, setTurnListOpen] = useState(false);
  const sessionWidth = useViewportWidth(sessionElement);
  const minimapSurface = agentMinimapHasPersistentGutter(sessionWidth) ? "rail" : "list";
  const minimapStripWidth = agentMinimapHitStripWidth(sessionWidth);
  const importedExchanges = displayedImportedHistory?.exchanges ?? NO_EXCHANGES;
  const importedTurns = useMemo(() => agentImportedTurns(importedExchanges), [importedExchanges]);
  const importedCarriesAttachments = useMemo(
    () => importedTurns.some((turn) => (turn.prompt?.attachments.length ?? 0) > 0),
    [importedTurns],
  );
  const minimap = useMemo(
    () => agentThreadMinimapModel(importedTurns, displayedTurns),
    [importedTurns, displayedTurns],
  );
  const measured = sessionElement !== null;
  const mapped = measured && minimap.entries.length >= MIN_AGENT_MINIMAP_ENTRIES;
  const inViewColumnKey = useAgentThreadTurnInView({
    columnSignature: `${importedTurns.length}:${displayedTurns.length}:${lastTurn?.turnId ?? ""}`,
    enabled: mapped && (minimapSurface === "rail" || turnListOpen),
    scrollRef,
    threadId,
  });
  const currentColumnIndex = agentMinimapEntryIndex(minimap, inViewColumnKey);
  const jumpToColumnEntry = useCallback(
    (anchor: AgentThreadColumnAnchor): void => {
      const container = scrollRef.current;
      if (container === null) return;
      const entry = columnElement(container, anchor);
      if (entry === null) return;
      releaseLatest();
      entry.scrollIntoView?.({ block: "start" });
      entry.querySelector<HTMLElement>(".agent-prompt__bubble")?.focus({ preventScroll: true });
    },
    [releaseLatest],
  );

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
    releaseLatest();
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
  }, [findOpen, releaseLatest]);

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

  const session = (
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
          {history !== undefined && (
            <AgentHistoryPager
              page={historyPage}
              hasEarlier={record.turnsTruncated}
              onEarlier={() => {
                void history.older(threadId);
              }}
              onNewer={
                history.newer === undefined
                  ? undefined
                  : () => {
                      void history.newer?.(threadId);
                    }
              }
              onLatest={history.latest}
            />
          )}
          {record.turnsTruncated && history === undefined && (
            <p className="agent-note agent-note--warning">
              Earlier turns were dropped to bound memory.
            </p>
          )}

          {provenanceNote !== null && (
            <p className="agent-note agent-session__provenance">{provenanceNote}</p>
          )}

          {record.externalOrigin != null && onEarlierImportedHistory !== undefined && (
            <nav aria-label="Original conversation history" className="agent-history-pager">
              <button
                type="button"
                disabled={externalHistoryState === "loading" || !hasEarlierImportedHistory}
                onClick={onEarlierImportedHistory}
              >
                Earlier imported messages
              </button>
              <button
                type="button"
                disabled={externalHistoryState === "loading"}
                onClick={onRetryExternalHistory}
              >
                Latest imported messages
              </button>
            </nav>
          )}
          {record.externalOrigin != null && (
            <AgentImportedHistory
              attachmentImages={importedCarriesAttachments ? attachmentImageViewer : null}
              highlights={importedHighlights}
              history={displayedImportedHistory}
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
              {displayedTurns.map((turn) => (
                <AgentHistoryActivity
                  key={turn.turnId}
                  turn={turn}
                  source={history?.activitySource?.(threadId, turn.turnId) ?? null}
                >
                  {(historyWork) => (
                    <>
                      <AgentTurnView
                        historyWork={historyWork}
                        attachmentImages={
                          agentTurnCarriesAttachments(turn) ? attachmentImageViewer : null
                        }
                        artifactScope={artifactScope}
                        highlight={highlightFor(turn.turnId)}
                        key={turn.turnId}
                        onOpenAgents={agents.openPanel}
                        subagents={agents.subagentsFor(turn.turnId)}
                        prose={prose}
                        provider={record.provider.kind}
                        executionTarget={thread.execution?.kind ?? "local"}
                        renderProbe={turnRenderProbe}
                        textClipboard={textClipboard}
                        turn={turn}
                        turnLog={turnLog}
                        workspaceRoot={record.target.worktreePath ?? record.owner.repositoryRoot}
                      />
                      {isTerminalAgentTurnStatus(turn.status) && getTurnChanges && (
                        <AgentRecordedTurnChanges
                          key={`${threadId}:${turn.turnId}`}
                          threadId={threadId}
                          turnId={turn.turnId}
                          onOpenDiff={(summary, path) => onOpenTurnDiff?.(threadId, summary, path)}
                          revision={turnChangesRevision}
                          getTurnChanges={getTurnChanges}
                        />
                      )}
                    </>
                  )}
                </AgentHistoryActivity>
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
                  state={entry.editLease === undefined ? entry.state : "editing"}
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
        </div>
      </div>

      <AgentJumpToLatest
        onJump={follow.jumpToLatest}
        unseenActivity={follow.unseenActivity}
        visible={!follow.atLatest}
      />
      <AgentBackgroundWorkBanner
        onStop={onStopBackground}
        provider={record.provider.kind}
        threadId={threadId}
        turn={liveTurn}
      />
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

  return (
    <AgentCodeColorizerContext.Provider value={colorizer}>
      <AgentAgentsDock agents={agents}>{session}</AgentAgentsDock>
    </AgentCodeColorizerContext.Provider>
  );
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

interface AgentTurnEventOffset {
  readonly turnId: string;
  readonly offset: number;
}

function prependedTurnIds(
  previous: ReadonlyArray<AgentTurnEventOffset>,
  next: ReadonlyArray<AgentTurnEventOffset>,
): ReadonlyArray<string> {
  if (previous.length === 0) return [];
  const before = new Map(previous.map((entry) => [entry.turnId, entry.offset]));
  const shifted: string[] = [];
  for (const entry of next) {
    const was = before.get(entry.turnId);
    if (was === undefined) continue;
    if (entry.offset >= was) continue;
    shifted.push(entry.turnId);
  }
  return shifted;
}

function turnInsertionTops(
  container: HTMLElement,
  turnIds: ReadonlyArray<string>,
): ReadonlyArray<number> | null {
  const containerTop = container.getBoundingClientRect().top;
  const tops: number[] = [];
  for (const turnId of turnIds) {
    const turn = turnElement(container, turnId);
    if (turn === null) return null;
    const events = turn.querySelector<HTMLElement>(".agent-turn__events");
    if (events === null) return null;
    tops.push(container.scrollTop + events.getBoundingClientRect().top - containerTop);
  }
  return tops;
}

function turnElement(container: HTMLElement, turnId: string): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-turn]"));
  return candidates.find((candidate) => candidate.dataset.agentTurn === turnId) ?? null;
}

function eventElement(turn: HTMLElement, eventIndex: number): HTMLElement | null {
  const key = agentTurnItemKey(eventIndex, turnEventOffset(turn));
  const candidates = Array.from(turn.querySelectorAll<HTMLElement>("[data-agent-event]"));
  return candidates.find((candidate) => candidate.dataset.agentEvent === key) ?? null;
}

function turnEventOffset(turn: HTMLElement): number {
  const raw = turn.dataset.agentTurnOffset;
  if (raw === undefined) return 0;
  return normalizeAgentTurnEventOffset(Number.parseInt(raw, 10));
}
