import { useId } from "react";
import { toolRowIcon } from "./agentToolRowIcon";
import { useAgentToolDisclosure } from "./AgentToolDisclosure";
import { agentToolFailureTag } from "./agentActivityGrouping";
import { AgentWorkStatusTag } from "./AgentWorkStatusTag";
import type { AgentTurnItem } from "./agentModePresentation";
import type { AgentToolItemStatus } from "./agentTurnProjection";

function toolRowClassName(status: AgentToolItemStatus): string {
  switch (status) {
    case "running":
      return "cv-work-row agent-tool-row agent-tool-row--running";
    case "error":
      return "cv-work-row agent-tool-row agent-tool-row--failed";
    case "stopped":
      return "cv-work-row agent-tool-row agent-tool-row--stopped";
    case "interrupted":
      return "cv-work-row agent-tool-row agent-tool-row--interrupted";
    case "ok":
      return "cv-work-row agent-tool-row";
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
        <span aria-hidden="true" className="cv-work-row__icon">
          <Icon className="agent-tool-row__icon" size={16} strokeWidth={1.5} />
        </span>
        <span className="agent-tool-row__label cv-work-row__title">{item.label}</span>
        <AgentWorkStatusTag text={agentToolFailureTag(item)} />
        {item.argument !== null && (
          <span className="agent-tool-row__argument cv-work-row__detail" title={item.argument}>
            {item.argument}
          </span>
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
