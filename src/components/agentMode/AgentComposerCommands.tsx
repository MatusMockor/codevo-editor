import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  agentComposerInvocation,
  agentComposerMenuItemKey,
  type AgentComposerMenuItem,
} from "../../domain/agentComposerCommand";
import { useAgentPopoverPlacement } from "./agentPopover";
import { agentComposerCommandOptionId } from "./useAgentComposerCommands";
import "./agentComposerCommands.css";

const METRICS = { gap: 6, margin: 8, maxWidth: 480, maxHeight: 320, minHeight: 0 };
const NOTICE_ID = "agent-composer-commands-notice";

interface Props {
  readonly anchor: RefObject<HTMLTextAreaElement | null>;
  readonly rows: ReadonlyArray<AgentComposerMenuItem>;
  readonly activeIndex: number;
  readonly notice: string | null;
  onChoose(item: AgentComposerMenuItem): void;
  onClose(): void;
}

export function AgentComposerCommands({
  anchor,
  rows,
  activeIndex,
  notice,
  onChoose,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const placement = useAgentPopoverPlacement(true, anchor, ref, "start", METRICS);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (ref.current?.contains(event.target) || anchor.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [anchor, onClose]);
  const activeKey = rowKey(rows[activeIndex]);
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, activeKey]);
  return createPortal(
    <div
      className={
        notice === null
          ? "agent-composer-commands"
          : "agent-composer-commands agent-composer-commands--noticed"
      }
      onMouseDown={(event) => event.preventDefault()}
      ref={ref}
      style={{ ...placement.style, width: placement.style.minWidth }}
    >
      <div
        aria-describedby={notice === null ? undefined : NOTICE_ID}
        aria-label="Composer commands"
        id="agent-composer-commands"
        role="listbox"
      >
        {rows.map((item, index) => (
          <div
            aria-selected={index === activeIndex}
            className={optionClassName(item, rows[index - 1])}
            id={agentComposerCommandOptionId(item)}
            key={agentComposerMenuItemKey(item)}
            onClick={() => onChoose(item)}
            role="option"
          >
            <AgentComposerCommandCopy item={item} />
          </div>
        ))}
      </div>
      {notice !== null && (
        <p className="agent-composer-commands__notice" id={NOTICE_ID}>
          {notice}
        </p>
      )}
    </div>,
    anchor.current?.closest(".app-shell") ?? document.body,
  );
}

function AgentComposerCommandCopy({ item }: { readonly item: AgentComposerMenuItem }) {
  const invocation = agentComposerInvocation(item);
  if (item.kind === "builtin")
    return (
      <span className="agent-composer-commands__copy">
        <span className="agent-composer-commands__heading">
          <span>{item.label}</span>
          <span className="agent-composer-commands__name">{invocation}</span>
        </span>
        <span className="agent-composer-commands__description">{item.description}</span>
      </span>
    );
  return (
    <span className="agent-composer-commands__copy">
      <span className="agent-composer-commands__heading">
        <span className="agent-composer-commands__title">
          {item.label === null ? (
            <span className="agent-composer-commands__invocation">{invocation}</span>
          ) : (
            <span>{item.label}</span>
          )}
          {item.argumentHint !== null && (
            <span className="agent-composer-commands__hint">{item.argumentHint}</span>
          )}
        </span>
        {item.label !== null && <span className="agent-composer-commands__name">{invocation}</span>}
      </span>
      {item.description !== null && (
        <span
          className="agent-composer-commands__description agent-composer-commands__description--line"
          title={item.description}
        >
          {item.description}
        </span>
      )}
    </span>
  );
}

function rowKey(item: AgentComposerMenuItem | undefined): string | null {
  if (item === undefined) return null;
  return agentComposerMenuItemKey(item);
}

function optionClassName(
  item: AgentComposerMenuItem,
  previous: AgentComposerMenuItem | undefined,
): string {
  if (item.kind === "builtin" || previous?.kind !== "builtin")
    return "agent-composer-commands__option";
  return "agent-composer-commands__option agent-composer-commands__option--group";
}
