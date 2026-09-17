import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, FileText, Globe, Search, SquarePen, Terminal, Wrench } from "lucide-react";
import { isAgentSubagentToolItem, type AgentTurnItem } from "./agentModePresentation";
import {
  AGENT_ACTIVITY_PAGE_SIZE,
  agentActivityEntries,
  type AgentActivityEntry,
} from "./agentActivityGrouping";
import "./agentActivityGroups.css";

interface Props {
  readonly scope?: string;
  readonly items: ReadonlyArray<AgentTurnItem>;
  readonly currentEventKey: string | null;
  readonly renderItem: (item: AgentTurnItem) => ReactNode;
}

export function AgentActivityItems({ items, currentEventKey, renderItem, scope = "root" }: Props) {
  const entries = useMemo(() => agentActivityEntries(items), [items]);
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
      <Fragment key={entry.key}>{renderItem(entry.item)}</Fragment>
    ),
  );
}

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
  const disclosure = useAgentToolDisclosure(
    JSON.stringify(["activity", scope, group.items[0]?.toolId ?? group.key]),
  );
  const [page, setPage] = useState(0);
  const found =
    currentEventKey === null ? -1 : group.items.findIndex((item) => item.key === currentEventKey);
  const expanded = disclosure.expanded || found >= 0;
  const lastPage = Math.floor((group.items.length - 1) / AGENT_ACTIVITY_PAGE_SIZE);
  const currentPage =
    found >= 0 ? Math.floor(found / AGENT_ACTIVITY_PAGE_SIZE) : Math.min(page, lastPage);
  const start = currentPage * AGENT_ACTIVITY_PAGE_SIZE;
  const visible = group.items.slice(start, start + AGENT_ACTIVITY_PAGE_SIZE);
  const running = group.items.filter((item) => item.status === "running");
  const latest = running[running.length - 1];
  const completed = group.items.filter(
    (item) => item.outcome !== null && !item.outcome.isError,
  ).length;
  const Icon =
    group.category === "command"
      ? Terminal
      : group.category === "edit"
        ? SquarePen
        : group.category === "read"
          ? FileText
          : group.category === "search"
            ? Search
            : group.category === "web"
              ? Globe
              : Wrench;
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
        <span className="agent-activity-group__label">{group.label}</span>
        <span className="agent-activity-group__status">
          {running.length > 0
            ? `${running.length} running`
            : completed > 0
              ? `${completed} completed`
              : null}
        </span>
        <ChevronDown className="agent-activity-group__chevron" aria-hidden="true" size={14} />
      </button>
      {latest !== undefined && (!expanded || !visible.some((item) => item.key === latest.key)) && (
        <div className="agent-activity-group__live">{renderItem(latest)}</div>
      )}
      <div id={id} hidden={!expanded} className="agent-activity-group__items">
        {expanded && (
          <>
            {visible.map((item) => (
              <Fragment key={item.key}>{renderItem(item)}</Fragment>
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
