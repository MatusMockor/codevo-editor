import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  AgentThreadActivityMenu,
  type AgentThreadActivityMenuPosition,
} from "./AgentThreadActivityMenu";
import {
  agentThreadActivityGroupLabel,
  agentThreadActivitySlotsTitle,
  agentThreadAttentionLabel,
  type AgentThreadActivitySummary,
} from "./agentThreadActivityPresentation";

export interface AgentThreadActivityProps {
  readonly summary: AgentThreadActivitySummary;
  readonly attentionVisible: boolean;
  readonly ownerKey: string | null;
  readonly onChangeAttentionVisible: ((visible: boolean) => void) | null;
}

interface OwnedMenu extends AgentThreadActivityMenuPosition {
  readonly owner: string | null;
}

export function AgentThreadActivity({
  attentionVisible,
  onChangeAttentionVisible,
  ownerKey,
  summary,
}: AgentThreadActivityProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<OwnedMenu | null>(null);
  useLayoutEffect(() => setMenu(null), [ownerKey]);
  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu(null);
    if (restoreFocus) groupRef.current?.focus();
  }, []);

  const openAt = (x: number, y: number): void => {
    if (onChangeAttentionVisible === null) return;
    setMenu({ x, y, owner: ownerKey });
  };
  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (onChangeAttentionVisible === null) return;
    event.preventDefault();
    openAt(event.clientX, event.clientY);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    if (onChangeAttentionVisible === null) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    openAt(rect.left + 8, rect.top);
  };
  const attentionShown = attentionVisible && summary.attention > 0;
  const explanationId = useId();

  return (
    <div
      aria-describedby={attentionShown ? explanationId : undefined}
      aria-label={agentThreadActivityGroupLabel(summary, attentionVisible)}
      className="agent-thread-activity"
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      ref={groupRef}
      role="group"
      tabIndex={0}
    >
      {summary.live > 0 ? (
        <span
          className="agent-thread-activity__running"
          title={agentThreadActivitySlotsTitle(summary)}
        >
          <span aria-hidden="true" className="agent-thread-activity__dot" />
          {`${summary.live} running`}
        </span>
      ) : null}
      {attentionShown ? (
        <>
          <span className="agent-thread-activity__attention" title={summary.attentionExplanation}>
            {agentThreadAttentionLabel(summary.attention)}
          </span>
          <span hidden id={explanationId}>
            {summary.attentionExplanation}
          </span>
        </>
      ) : null}
      {menu !== null && menu.owner === ownerKey && onChangeAttentionVisible !== null ? (
        <AgentThreadActivityMenu
          disabled={ownerKey === null}
          onClose={closeMenu}
          onToggle={() => onChangeAttentionVisible(!attentionVisible)}
          position={menu}
          visible={attentionVisible}
        />
      ) : null}
    </div>
  );
}
