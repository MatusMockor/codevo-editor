import { useId } from "react";
import {
  Bot,
  FileText,
  Globe,
  Search,
  SquarePen,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  unsupportedToolRowKind,
  type AgentToolRowKind,
} from "../../domain/agentToolRowPresentation";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import type { AgentTurnItem } from "./agentModePresentation";
import type { AgentToolItemStatus } from "./agentTurnProjection";

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

function toolRowClassName(status: AgentToolItemStatus): string {
  switch (status) {
    case "running":
      return "agent-tool-row agent-tool-row--running";
    case "error":
      return "agent-tool-row agent-tool-row--failed";
    case "stopped":
      return "agent-tool-row agent-tool-row--stopped";
    case "interrupted":
      return "agent-tool-row agent-tool-row--interrupted";
    case "ok":
      return "agent-tool-row";
    default:
      return unsupportedToolRowStatus(status);
  }
}

function unsupportedToolRowStatus(status: never): never {
  throw new TypeError(`Unsupported agent tool row status: ${String(status)}.`);
}

export function AgentToolRow({
  item,
}: {
  readonly item: Extract<AgentTurnItem, { kind: "tool" }>;
}) {
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
      {item.output === null && <p className="agent-tool-row__empty">{emptyOutputText(item)}</p>}
    </>
  );
}

function emptyOutputText(item: Extract<AgentTurnItem, { kind: "tool" }>): string {
  if (item.status === "interrupted") return "No result was recorded before the turn ended.";
  if (item.status === "stopped") return "Stopped before a result was recorded.";
  return "No output";
}
