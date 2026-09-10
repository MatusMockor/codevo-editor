import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentMarkdownViewport } from "../../application/agentMarkdownViewport";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
  sameAgentProviderError,
  type AgentProviderError,
} from "../../domain/agentOutput/agentProviderError";
import { isAgentRawOutputNoise } from "../../domain/agentOutput/agentRawOutput";
import type { TextClipboardGateway } from "../../domain/textClipboard";
import type { AgentThreadFindHit } from "../../domain/agentThreadSearch";
import type { AgentMarkdownRenderer } from "../../domain/agentMarkdown/agentMarkdownRenderer";
import { agentExternalOriginNote, type AgentThreadRevealRequest } from "./agentSidebarPresentation";
import { AgentWorkingDuration } from "./agentClock";
import { AgentThreadChangesCue } from "./AgentThreadChangesCue";
import { AgentMessageCopyButton } from "./AgentMessageCopyButton";
import { AgentImportedHistory, type AgentExternalHistoryState } from "./AgentImportedHistory";
import { AgentTurnHead, AgentTurnPrompt } from "./AgentTurnParts";
import { agentTurnTiming } from "./agentTurnHeadPresentation";
import {
  AgentAssistantText,
  type AgentItemHighlight,
  type AgentProseContext,
  type AgentProseStream,
} from "./AgentAssistantText";
import { openAgentMarkdownLink, type AgentExternalLinkOpener } from "./agentMarkdownLinks";
import { agentImportedHighlights } from "./agentImportedPresentation";
import { HighlightRun } from "./agentThreadHighlight";
import { useAgentMarkdownRenderer } from "./useAgentMarkdown";
import { createIntersectionAgentMarkdownViewport } from "../../infrastructure/viewport/intersectionAgentMarkdownViewport";
import {
  agentWorktreeRemovalLabel,
  agentTurnDurationLabel,
  agentTurnProjection,
  agentTurnSubagentSummary,
  agentTurnWorkFold,
  isAgentSubagentToolItem,
  type AgentRawLine,
  type AgentSubagentEntry,
  type AgentSubagentSummary,
  type AgentTurnItem,
} from "./agentModePresentation";

const NO_FIND_HITS: ReadonlyArray<AgentThreadFindHit> = [];

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

interface AgentTurnErrorContext {
  readonly provider: AgentCliKind;
  readonly installedVersion: string | null;
}

export interface AgentThreadSessionProps {
  readonly thread: AgentThreadView | null;
  readonly composerRepositoryLabel: string | null;
  readonly turnRenderProbe?: (turnId: string) => void;
  readonly findQuery?: string;
  readonly findHits?: ReadonlyArray<AgentThreadFindHit>;
  readonly findHitIndex?: number;
  readonly reveal?: AgentThreadRevealRequest | null;
  readonly textClipboard?: TextClipboardGateway | null;
  readonly markdownRenderer?: AgentMarkdownRenderer | null;
  readonly markdownViewport?: AgentMarkdownViewport | null;
  readonly openExternalLink?: AgentExternalLinkOpener;
  readonly externalHistoryState?: AgentExternalHistoryState;
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
  findHitIndex,
  findHits,
  findQuery,
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
    target.element.scrollIntoView?.({ block: target.block });
  }, [activeHit, reveal]);

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

  const highlightFor = (turnIdentity: string): AgentTurnHighlight | null => {
    if (query === "") return null;
    if (activeHit?.scope === "turn" && activeHit.turnId === turnIdentity) return activeHighlight;
    if (!hitTurnIds.has(turnIdentity)) return null;
    return baseHighlight;
  };

  return (
    <section aria-label={`Agent thread ${threadId}`} className="agent-session">
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
              highlights={importedHighlights}
              history={record.externalOrigin.history}
              key={`${threadId}:${record.externalOrigin.sessionId}`}
              onRetry={onRetryExternalHistory}
              prose={prose}
              state={externalHistoryState}
              textClipboard={textClipboard}
            />
          )}

          <div className="agent-turn-list">
            {record.turns.map((turn) => (
              <AgentTurnView
                highlight={highlightFor(turn.turnId)}
                key={turn.turnId}
                prose={prose}
                provider={record.provider.kind}
                renderProbe={turnRenderProbe}
                textClipboard={textClipboard}
                turn={turn}
              />
            ))}
          </div>

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
    </section>
  );
}

const AgentTurnView = memo(function AgentTurnView({
  highlight = null,
  prose,
  provider,
  renderProbe,
  textClipboard,
  turn,
}: {
  readonly highlight?: AgentTurnHighlight | null;
  readonly prose: AgentProseContext;
  readonly provider: AgentCliKind;
  readonly renderProbe?: (turnId: string) => void;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentTurn;
}) {
  renderProbe?.(turn.turnId);
  const projection = agentTurnProjection(turn.events);
  const subagents = agentTurnSubagentSummary(turn.events);
  const running = turn.status.kind === "pending" || turn.status.kind === "running";
  const [streamed, setStreamed] = useState(running);

  useEffect(() => {
    if (!running) return;
    if (streamed) return;
    setStreamed(true);
  }, [running, streamed]);

  const stream = proseStream(running, streamed);
  const errorContext: AgentTurnErrorContext = { provider, installedVersion: turn.cliVersion };
  const rawLines = projection.rawLines.filter(
    (line) => !isAgentRawOutputNoise(provider, line.stream, line.raw),
  );
  const empty = projection.items.length === 0 && rawLines.length === 0;
  const workFold = agentTurnWorkFold(projection.items, running);
  const cursor = highlight?.current ?? null;
  const promptCurrent = cursor !== null && cursor.kind === "prompt" ? cursor.occurrence : null;
  const rawDisclosed = rawOutputDisclosed(turn.status);
  const rawOutput =
    rawLines.length === 0 || !rawDisclosed ? null : <AgentRawOutput lines={rawLines} />;
  const failure = turnFailure(turn.status, errorContext);

  return (
    <article
      aria-label={`Agent turn ${turn.turnId}`}
      className="agent-turn"
      data-agent-turn={turn.turnId}
    >
      <AgentTurnPrompt
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

        {projection.hiddenCount > 0 && (
          <p className="agent-note">{projection.hiddenCount} earlier events hidden</p>
        )}

        <div className="agent-turn__events">
          {subagents !== null && <AgentSubagentBanner summary={subagents} />}
          {workFold === null && subagents !== null && (
            <AgentSubagentList entries={subagents.entries} />
          )}
          {workFold !== null && (
            <AgentTurnWork
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
                errorContext={errorContext}
                highlight={itemHighlight(highlight, item.key)}
                item={item}
                key={item.key}
                prose={prose}
                stream={stream}
                textClipboard={textClipboard}
              />
            ))}
          {empty && running && (
            <p className="agent-note">
              Waiting for output…
              <span aria-hidden="true" className="agent-well__caret" />
            </p>
          )}
        </div>

        {rawOutput !== null && <div className="agent-message-actions">{rawOutput}</div>}

        {turn.eventsTruncated && (
          <p className="agent-note agent-note--warning">
            Later output was dropped to bound memory.
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
            <AgentProviderErrorHint error={failure} />
          </section>
        )}
      </div>
    </article>
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
  errorContext,
  highlight,
  items,
  prose,
  running,
  stream,
  subagents,
  summary,
  textClipboard,
  turn,
}: {
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentTurnHighlight | null;
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly prose: AgentProseContext;
  readonly running: boolean;
  readonly stream: AgentProseStream;
  readonly subagents: AgentSubagentSummary | null;
  readonly summary: string;
  readonly textClipboard: TextClipboardGateway | null;
  readonly turn: AgentTurn;
}) {
  const title = running ? (
    <>
      Working for <AgentWorkingDuration startedAtEpochMs={turn.startedAtEpochMs} />
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
              errorContext={errorContext}
              highlight={itemHighlight(highlight, item.key)}
              item={item}
              key={item.key}
              prose={prose}
              stream={stream}
              textClipboard={textClipboard}
            />
          ))}
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
  readonly errorContext: AgentTurnErrorContext;
  readonly highlight: AgentItemHighlight | null;
  readonly item: AgentTurnItem;
  readonly prose: AgentProseContext;
  readonly stream: AgentProseStream;
  readonly textClipboard: TextClipboardGateway | null;
}

function AgentTurnItemView({
  errorContext,
  highlight,
  item,
  prose,
  stream,
  textClipboard,
}: AgentTurnItemViewProps) {
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
        {error !== null && <AgentProviderErrorHint error={error} />}
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
      <AgentProviderErrorHint error={error} />
    </section>
  );
}

function proseStream(running: boolean, streamed: boolean): AgentProseStream {
  if (running) return "streaming";
  if (streamed) return "streamed";
  return "settled";
}

function AgentProviderErrorHint({ error }: { readonly error: AgentProviderError }): ReactNode {
  if (error.detail.kind !== "unsupportedModelForCliVersion") return null;

  return (
    <>
      <p className="agent-note">Open Settings &gt; Agents to update it.</p>
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

function turnFailure(
  status: AgentTurnStatus,
  context: AgentTurnErrorContext,
): AgentProviderError | null {
  if (status.kind !== "failed") return null;

  return classifyAgentProviderError(status.message, context.provider);
}

function repeatsLastError(
  failure: AgentProviderError,
  items: ReadonlyArray<AgentTurnItem>,
  context: AgentTurnErrorContext,
): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const reported = reportedError(items[index], context);
    if (reported === null) continue;
    if (reported.detail.kind === "advisory") continue;

    return sameAgentProviderError(failure, reported);
  }

  return false;
}

function reportedError(
  item: AgentTurnItem | undefined,
  context: AgentTurnErrorContext,
): AgentProviderError | null {
  if (item === undefined) return null;
  if (item.kind === "error") return classifyAgentProviderError(item.message, context.provider);
  if (item.kind === "result" && item.isError) {
    return classifyAgentProviderError(item.text, context.provider);
  }

  return null;
}

function formatTokens(tokens: number): string {
  return tokens >= 1_000 ? `${Math.round(tokens / 1_000)}k` : String(tokens);
}

function AgentToolRow({ item }: { readonly item: Extract<AgentTurnItem, { kind: "tool" }> }) {
  const outcome = item.outcome;
  const statusClassName =
    outcome === null
      ? "agent-tool__status"
      : `agent-tool__status agent-tool__status--${outcome.isError ? "bad" : "ok"}`;
  const statusLabel = outcome === null ? "running" : outcome.isError ? "error" : "ok";

  return (
    <div className="agent-tool" title={outcome?.outputSummary ?? undefined}>
      <span className="agent-tool__name">{item.name}</span>
      <span className="agent-tool__input">{item.inputSummary}</span>
      <span className={statusClassName}>{statusLabel}</span>
    </div>
  );
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

function turnElement(container: HTMLElement, turnId: string): HTMLElement | null {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-agent-turn]"));
  return candidates.find((candidate) => candidate.dataset.agentTurn === turnId) ?? null;
}

function eventElement(turn: HTMLElement, eventIndex: number): HTMLElement | null {
  const key = `e${eventIndex}`;
  const candidates = Array.from(turn.querySelectorAll<HTMLElement>("[data-agent-event]"));
  return candidates.find((candidate) => candidate.dataset.agentEvent === key) ?? null;
}
