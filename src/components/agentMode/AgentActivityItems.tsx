import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  ChevronDown,
  FileText,
  Globe,
  Search,
  SquarePen,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { isAgentSubagentToolItem, type AgentTurnItem } from "./agentModePresentation";
import {
  AGENT_ACTIVITY_PAGE_SIZE,
  AGENT_ACTIVITY_THOUGHT_CATEGORY,
  agentActivityEntries,
  agentThoughtPresentation,
  type AgentActivityEntry,
  type AgentActivityMember,
  type AgentActivityTool,
  type AgentActivityTurnState,
  type AgentThoughtPresentation,
} from "./agentActivityGrouping";
import "./agentActivityGroups.css";

interface Props {
  readonly scope?: string;
  readonly turn?: AgentActivityTurnState;
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly currentEventKey: string | null;
  readonly renderItem: (item: AgentTurnItem, thought: AgentThoughtPresentation | null) => ReactNode;
}

export function AgentActivityItems({
  items,
  currentEventKey,
  renderItem,
  scope = "root",
  turn = "settled",
}: Props) {
  const entries = useMemo(() => agentActivityEntries(items, turn), [items, turn]);
  return entries.map((entry) =>
    entry.kind === "group" ? (
      <AgentActivityGroup
        key={entry.key}
        group={entry}
        scope={scope}
        currentEventKey={currentEventKey}
        renderItem={renderItem}
      />
    ) : isAgentSubagentToolItem(entry.item) ? null : (
      <Fragment key={entry.key}>{renderItem(entry.item, null)}</Fragment>
    ),
  );
}

function latestRunning(items: ReadonlyArray<AgentActivityMember>): AgentActivityTool | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "tool" && item.status === "running") return item;
  }
  return undefined;
}

const CATEGORY_ICONS: ReadonlyMap<string, LucideIcon> = new Map([
  ["command", Terminal],
  ["edit", SquarePen],
  ["read", FileText],
  ["search", Search],
  ["web", Globe],
  [AGENT_ACTIVITY_THOUGHT_CATEGORY, Brain],
]);

function AgentActivityGroup({
  group,
  scope,
  currentEventKey,
  renderItem,
}: {
  readonly group: Extract<AgentActivityEntry, { kind: "group" }>;
  readonly scope: string;
  readonly currentEventKey: string | null;
  readonly renderItem: Props["renderItem"];
}) {
  const id = useId();
  const disclosure = useAgentToolDisclosure(JSON.stringify(["activity", scope, group.key]));
  const [page, setPage] = useState(0);
  const found =
    currentEventKey === null ? -1 : group.items.findIndex((item) => item.key === currentEventKey);
  const expanded = disclosure.expanded || found >= 0;
  const lastPage = Math.floor((group.items.length - 1) / AGENT_ACTIVITY_PAGE_SIZE);
  const currentPage =
    found >= 0 ? Math.floor(found / AGENT_ACTIVITY_PAGE_SIZE) : Math.min(page, lastPage);
  const start = currentPage * AGENT_ACTIVITY_PAGE_SIZE;
  const visible = group.items.slice(start, start + AGENT_ACTIVITY_PAGE_SIZE);
  const latest = latestRunning(group.items);
  const Icon = CATEGORY_ICONS.get(group.category) ?? Wrench;
  const render = (item: AgentActivityMember) =>
    renderItem(
      item,
      item.kind === "reasoning" ? agentThoughtPresentation(group, item, scope) : null,
    );
  return (
    <section className="agent-activity-group">
      <button
        className="agent-tool-row agent-activity-group__toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={disclosure.toggle}
      >
        <Icon className="agent-tool-row__icon" aria-hidden="true" size={15} />
        <span
          className={
            group.phase === "thinking"
              ? "agent-activity-group__label agent-activity-group__label--live"
              : "agent-activity-group__label"
          }
        >
          {group.label}
        </span>
        <span className="agent-activity-group__status">
          {group.running > 0
            ? `${group.running} running`
            : group.completed > 0
              ? `${group.completed} completed`
              : null}
        </span>
        <ChevronDown className="agent-activity-group__chevron" aria-hidden="true" size={14} />
      </button>
      {latest !== undefined && (!expanded || !visible.some((item) => item.key === latest.key)) && (
        <div className="agent-activity-group__live">{renderItem(latest, null)}</div>
      )}
      <div id={id} hidden={!expanded} className="agent-activity-group__items">
        {expanded && (
          <>
            {visible.map((item) => (
              <Fragment key={item.key}>{render(item)}</Fragment>
            ))}
            {lastPage > 0 && (
              <nav aria-label="Activity pages" className="agent-activity-group__pages">
                <button
                  type="button"
                  disabled={currentPage === 0 || found >= 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Previous
                </button>
                <span>
                  {start + 1}–{Math.min(start + AGENT_ACTIVITY_PAGE_SIZE, group.items.length)} of{" "}
                  {group.items.length}
                </span>
                <button
                  type="button"
                  disabled={currentPage === lastPage || found >= 0}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Next
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </section>
  );
}
