import { useRef, type DragEvent } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { runningTurn } from "../../domain/agentThread";
import {
  sameThreadOrganizationOwner,
  type AgentThreadDropSection,
} from "../../domain/agentThreadOrganization";
import type { AgentRailSections, AgentThreadMenuCommand } from "./agentSidebarPresentation";

export function useAgentThreadDrag(
  sections: AgentRailSections,
  command: (id: string, command: AgentThreadMenuCommand) => void,
) {
  const source = useRef<AgentThreadView | null>(null);
  const indicator = useRef<HTMLElement | null>(null);
  const rows = [
    ...sections.pinned,
    ...sections.active,
    ...(sections.snoozed ?? []),
    ...(sections.settled ?? []),
  ];
  const clearIndicator = () => {
    indicator.current?.removeAttribute("data-drop-placement");
    indicator.current = null;
  };
  const finish = () => {
    source.current = null;
    clearIndicator();
  };
  const resolve = (event: DragEvent) => {
    const captured = source.current;
    const current = rows.find((view) => view.thread.threadId === captured?.thread.threadId);
    if (!captured || !current || !compatible(captured, current)) return null;
    const element =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-thread-id], [data-thread-drop-section]")
        : null;
    if (!element) return null;
    let target = element.dataset.threadId
      ? rows.find((view) => view.thread.threadId === element.dataset.threadId)
      : current;
    if (!target || !compatible(current, target)) return null;
    const destination =
      element.dataset.threadDropSection ??
      (sections.pinned.includes(target)
        ? "pinned"
        : sections.active.includes(target)
          ? "active"
          : (sections.settled ?? []).includes(target)
            ? "settled"
            : null);
    if (destination !== "pinned" && destination !== "active" && destination !== "settled")
      return null;
    if (
      destination === "settled" &&
      (current.lifecycle === "running" || runningTurn(current.thread))
    )
      return null;
    if (element.dataset.threadDropSection) {
      const destinationRows =
        destination === "pinned"
          ? sections.pinned
          : destination === "active"
            ? sections.active
            : (sections.settled ?? []);
      target =
        [...destinationRows]
          .reverse()
          .find(
            (view) => view.thread.threadId !== current.thread.threadId && compatible(current, view),
          ) ?? current;
    }
    const placement = element.dataset.threadDropSection
      ? "after"
      : event.clientY >
          element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
        ? "after"
        : "before";
    return { element, current, target, destination, placement } as const;
  };
  return {
    marker: (section: AgentThreadDropSection, label: string) => (
      <li role="none" className="agent-thread-drop-zone" data-thread-drop-section={section}>
        {label}
      </li>
    ),
    handlers: {
      onDragStart(event: DragEvent<HTMLUListElement>) {
        const id =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId
            : undefined;
        source.current = rows.find((view) => view.thread.threadId === id) ?? null;
        if (!source.current) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", source.current.thread.threadId);
      },
      onDragEnd: finish,
      onDragLeave(event: DragEvent<HTMLUListElement>) {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          clearIndicator();
      },
      onDragOver(event: DragEvent<HTMLUListElement>) {
        clearIndicator();
        const drop = resolve(event);
        if (!drop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        indicator.current = drop.element;
        drop.element.dataset.dropPlacement = drop.placement;
      },
      onDrop(event: DragEvent<HTMLUListElement>) {
        const drop = resolve(event);
        finish();
        if (!drop) return;
        event.preventDefault();
        command(drop.current.thread.threadId, {
          kind: drop.placement === "before" ? "moveBefore" : "moveAfter",
          targetThreadId: drop.target.thread.threadId,
          destination: drop.destination,
        });
      },
    },
  };
}
function compatible(a: AgentThreadView, b: AgentThreadView) {
  return (
    sameThreadOrganizationOwner(a.thread.owner, b.thread.owner) &&
    (a.execution?.kind === "remote" ? a.execution.serverId : null) ===
      (b.execution?.kind === "remote" ? b.execution.serverId : null)
  );
}
