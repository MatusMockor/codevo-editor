import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import type {
  AgentComposerCommand,
  AgentComposerCommandId,
} from "../../domain/agentComposerCommand";
import { useAgentPopoverPlacement } from "./agentPopover";
import "./agentComposerCommands.css";

const METRICS = { gap: 6, margin: 8, maxWidth: 480, maxHeight: 320, minHeight: 0 };

interface Props {
  readonly anchor: RefObject<HTMLTextAreaElement | null>;
  readonly rows: ReadonlyArray<AgentComposerCommand>;
  readonly activeIndex: number;
  onChoose(id: AgentComposerCommandId): void;
  onClose(): void;
}

export function AgentComposerCommands({ anchor, rows, activeIndex, onChoose, onClose }: Props) {
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
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);
  return createPortal(
    <div
      aria-label="Composer commands"
      className="agent-composer-commands"
      id="agent-composer-commands"
      ref={ref}
      role="listbox"
      style={{ ...placement.style, width: placement.style.minWidth }}
    >
      {rows.map((command, index) => (
        <div
          aria-selected={index === activeIndex}
          className="agent-composer-commands__option"
          id={`agent-composer-command-${command.id}`}
          key={command.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(command.id)}
          role="option"
        >
          <span className="agent-composer-commands__copy">
            <span className="agent-composer-commands__heading">
              <span>{command.label}</span>
              <span className="agent-composer-commands__name">/{command.id}</span>
            </span>
            <span className="agent-composer-commands__description">{command.description}</span>
          </span>
        </div>
      ))}
    </div>,
    anchor.current?.closest(".app-shell") ?? document.body,
  );
}
