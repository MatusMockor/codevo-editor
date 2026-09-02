import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentTurn } from "../../domain/agentThread";
import {
  MIN_THREAD_SEARCH_QUERY_CHARS,
  type AgentThreadFindHit,
  type AgentThreadSearchRange,
} from "../../domain/agentThreadSearch";
import { agentExternalOriginNote, type AgentThreadRevealRequest } from "./agentSidebarPresentation";
import { AgentRelativeTime } from "./agentClock";
import { AgentThreadChangesCue } from "./AgentThreadChangesCue";
import {
  agentWorktreeRemovalLabel,
  agentTurnProjection,
  agentTurnSubagentSummary,
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

interface AgentItemHighlight {
  readonly query: string;
  readonly current: number | null;
}

interface AgentParagraphRun {
  readonly text: string;
  readonly current: number | null;
}

export interface AgentThreadSessionProps {
  readonly thread: AgentThreadView | null;
  readonly composerRepositoryLabel: string | null;
  readonly turnRenderProbe?: (turnId: string) => void;
  readonly findQuery?: string;
  readonly findHits?: ReadonlyArray<AgentThreadFindHit>;
  readonly findHitIndex?: number;
  readonly reveal?: AgentThreadRevealRequest | null;
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
  thread,
  turnRenderProbe,
}: AgentThreadSessionBodyProps) {
  const record = thread.thread;
  const threadId = record.threadId;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hits = findHits ?? NO_FIND_HITS;
  const query = findQuery ?? "";
  const activeHit = findHitIndex === undefined ? null : (hits[findHitIndex] ?? null);
  const worktreeRemovalLabel = agentWorktreeRemovalLabel(thread);
  const provenanceNote = agentExternalOriginNote(record.externalOrigin);

  const hitTurnIds = useMemo(() => new Set(hits.map((hit) => hit.turnId)), [hits]);
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
    target?.scrollIntoView?.({ block: "center" });
  }, [activeHit, reveal]);

  const highlightFor = (turnIdentity: string): AgentTurnHighlight | null => {
    if (query === "") return null;
    if (activeHit !== null && activeHit.turnId === turnIdentity) return activeHighlight;
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

          {record.turns.map((turn) => (
            <AgentTurnView
              highlight={highlightFor(turn.turnId)}
              key={turn.turnId}
              renderProbe={turnRenderProbe}
              turn={turn}
            />
          ))}

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
  renderProbe,
  turn,
}: {
  readonly highlight?: AgentTurnHighlight | null;
  readonly renderProbe?: (turnId: string) => void;
  readonly turn: AgentTurn;
}) {
  renderProbe?.(turn.turnId);
  const projection = agentTurnProjection(turn.events);
  const subagents = agentTurnSubagentSummary(turn.events);
  const running = turn.status.kind === "pending" || turn.status.kind === "running";
  const empty = projection.items.length === 0 && projection.rawLines.length === 0;
  const cursor = highlight?.current ?? null;
  const promptCurrent = cursor !== null && cursor.kind === "prompt" ? cursor.occurrence : null;

  return (
    <article
      aria-label={`Agent turn ${turn.turnId}`}
      className="agent-turn"
      data-agent-turn={turn.turnId}
    >
      <article className="agent-prompt">
        <div className="agent-prompt__body">
          <HighlightRun current={promptCurrent} query={highlight?.query ?? ""} text={turn.prompt} />
        </div>
        <div className="agent-prompt__meta agent-num" aria-label="Message time">
          <span>
            <AgentRelativeTime epochMs={turn.startedAtEpochMs} />
          </span>
        </div>
      </article>

      {projection.hiddenCount > 0 && (
        <p className="agent-note">{projection.hiddenCount} earlier events hidden</p>
      )}

      <div className="agent-turn__events">
        {subagents !== null && <AgentSubagentSummary summary={subagents} />}
        {projection.items.map((item) => (
          <AgentTurnItemView
            highlight={itemHighlight(highlight, item.key)}
            item={item}
            key={item.key}
          />
        ))}
        {empty && running && (
          <p className="agent-note">
            Waiting for output…
            <span aria-hidden="true" className="agent-well__caret" />
          </p>
        )}
      </div>

      {projection.rawLines.length > 0 && (
        <details className="agent-raw">
          <summary className="agent-microlabel">raw output</summary>
          <pre className="agent-raw__lines">
            {projection.rawLines.map((line) => line.raw).join("\n")}
          </pre>
        </details>
      )}

      {turn.eventsTruncated && (
        <p className="agent-note agent-note--warning">Later output was dropped to bound memory.</p>
      )}

      {turn.status.kind === "interrupted" && (
        <p className="agent-note agent-note--warning">Interrupted by app restart</p>
      )}

      {turn.status.kind === "failed" && (
        <section className="agent-finale agent-finale--bad">
          <span className="agent-microlabel agent-microlabel--bad">run failed</span>
          <p className="agent-finale__body">{turn.status.message}</p>
        </section>
      )}
    </article>
  );
});

function AgentSubagentSummary({
  summary,
}: {
  readonly summary: NonNullable<ReturnType<typeof agentTurnSubagentSummary>>;
}) {
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

function AgentTurnItemView({
  highlight,
  item,
}: {
  readonly highlight: AgentItemHighlight | null;
  readonly item: AgentTurnItem;
}) {
  if (item.kind === "assistantText") {
    return (
      <div className="agent-text" data-agent-event={item.key}>
        {paragraphRuns(item.paragraphs, highlight).map((run, index) => (
          <p className="agent-text__paragraph" key={`${item.key}p${index}`}>
            <HighlightRun current={run.current} query={highlight?.query ?? ""} text={run.text} />
          </p>
        ))}
      </div>
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
        {item.text !== "" && (
          <p className="agent-finale__body">
            <HighlightRun
              current={highlight?.current ?? null}
              query={highlight?.query ?? ""}
              text={item.text}
            />
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="agent-finale agent-finale--bad">
      <span className="agent-microlabel agent-microlabel--bad">error</span>
      <p className="agent-finale__body">{item.message}</p>
    </section>
  );
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
          <AgentEmptyFigure />
          <h2 className="agent-empty__title">
            {repositoryLabel === null
              ? "No Git repository detected"
              : `Start a thread in ${repositoryLabel}`}
          </h2>
          <p className="agent-empty__text">
            Describe the change. The agent picks up the repository below, works through the task,
            and comes back with output you can review.
          </p>
          {repositoryLabel !== null && (
            <p className="agent-empty__hints">
              <span className="agent-empty__hint">
                <kbd>⌘</kbd>
                <kbd>↩</kbd> starts the run
              </span>
              <span aria-hidden="true" className="agent-prompt__sep" />
              <span className="agent-empty__hint">
                <span className="agent-empty__chip">worktree</span> keeps your working tree
                untouched
              </span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentEmptyFigure() {
  return (
    <svg
      aria-hidden="true"
      className="agent-empty__figure"
      fill="none"
      height="56"
      viewBox="0 0 72 56"
      width="72"
    >
      <path d="M8 8v40" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="48" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 20c0 10 22 4 30 10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <path
        className="agent-empty__accent"
        d="M38 30h18"
        stroke="currentColor"
        strokeDasharray="1 5"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
      <circle
        className="agent-empty__accent"
        cx="61"
        cy="30"
        r="3.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function HighlightRun({
  current,
  query,
  text,
}: {
  readonly current: number | null;
  readonly query: string;
  readonly text: string;
}): ReactNode {
  const ranges = queryRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark
        className={
          index === current ? "agent-find__hit agent-find__hit--current" : "agent-find__hit"
        }
        data-hit-index={index}
        key={`h${index}`}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}

function queryRanges(text: string, query: string): ReadonlyArray<AgentThreadSearchRange> {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_THREAD_SEARCH_QUERY_CHARS) return [];

  const haystack = text.toLowerCase();
  const ranges: AgentThreadSearchRange[] = [];
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    ranges.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + needle.length);
  }
  return ranges;
}

function occurrenceCount(text: string, query: string): number {
  return queryRanges(text, query).length;
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

function paragraphRuns(
  paragraphs: ReadonlyArray<string>,
  highlight: AgentItemHighlight | null,
): ReadonlyArray<AgentParagraphRun> {
  if (highlight === null) return paragraphs.map((text) => ({ text, current: null }));

  const runs: AgentParagraphRun[] = [];
  let consumed = 0;
  for (const text of paragraphs) {
    const start = consumed;
    consumed += occurrenceCount(text, highlight.query);
    const current = highlight.current;
    const local =
      current !== null && current >= start && current < consumed ? current - start : null;
    runs.push({ text, current: local });
  }
  return runs;
}

function turnCursor(
  hits: ReadonlyArray<AgentThreadFindHit>,
  index: number,
): AgentTurnHighlightCursor | null {
  const hit = hits[index];
  if (hit === undefined) return null;

  let occurrence = 0;
  for (let position = 0; position < index; position += 1) {
    const other = hits[position];
    if (other === undefined) continue;
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
): HTMLElement | null {
  const current = container.querySelector<HTMLElement>(".agent-find__hit--current");
  if (current !== null) return current;

  const turnId = reveal?.turnId ?? activeHit?.turnId ?? null;
  if (turnId === null) return null;

  const turn = turnElement(container, turnId);
  if (turn === null) return null;

  const eventIndex = reveal?.eventIndex ?? activeHit?.eventIndex ?? null;
  if (eventIndex === null) return turn;
  return eventElement(turn, eventIndex) ?? turn;
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
