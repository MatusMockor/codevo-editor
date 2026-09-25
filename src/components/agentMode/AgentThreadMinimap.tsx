import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  agentMinimapDistance,
  type AgentMinimapEntry,
  type AgentThreadMinimapModel,
} from "./agentThreadMinimapPresentation";
import { AGENT_MINIMAP_HIT_STRIP_MAX } from "./agentMinimapPlacement";
import type { AgentThreadColumnAnchor } from "./agentThreadColumn";
import { useAgentPopover, useAgentPopoverPlacement } from "./agentPopover";
import { useAgentMinimapPreview } from "./agentMinimapPreview";

export const MIN_AGENT_MINIMAP_ENTRIES = 2;

export type AgentMinimapSurface = "rail" | "list";

export interface AgentThreadMinimapProps {
  readonly model: AgentThreadMinimapModel;
  readonly currentIndex: number;
  readonly surface: AgentMinimapSurface;
  readonly stripWidth?: number;
  readonly openSignal?: number;
  onJump(anchor: AgentThreadColumnAnchor): void;
  onOpenChange?(open: boolean): void;
}

export function AgentThreadMinimap({
  currentIndex,
  model,
  onJump,
  onOpenChange,
  openSignal = 0,
  stripWidth = AGENT_MINIMAP_HIT_STRIP_MAX,
  surface,
}: AgentThreadMinimapProps) {
  if (model.entries.length < MIN_AGENT_MINIMAP_ENTRIES) return null;

  if (surface === "rail") {
    return (
      <AgentMinimapRail
        currentIndex={currentIndex}
        model={model}
        onJump={onJump}
        openSignal={openSignal}
        stripWidth={stripWidth}
      />
    );
  }

  return (
    <AgentMinimapDisclosure
      currentIndex={currentIndex}
      model={model}
      onJump={onJump}
      onOpenChange={onOpenChange}
      openSignal={openSignal}
    />
  );
}

function AgentMinimapRail({
  currentIndex,
  model,
  onJump,
  openSignal,
  stripWidth,
}: {
  readonly currentIndex: number;
  readonly model: AgentThreadMinimapModel;
  readonly openSignal: number;
  readonly stripWidth: number;
  onJump(anchor: AgentThreadColumnAnchor): void;
}) {
  const strip = Math.max(0, stripWidth);
  const className = [
    "agent-minimap",
    "agent-minimap--rail",
    `agent-minimap--${model.density}`,
    strip === 0 ? "agent-minimap--inert" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");

  return (
    <nav
      aria-label="Your turns"
      className={className}
      style={{ "--minimap-strip": `${strip}px` } as CSSProperties}
    >
      <AgentTurnJumpList
        currentIndex={currentIndex}
        entries={model.entries}
        focusSignal={openSignal}
        onJump={onJump}
        surface="rail"
      />
    </nav>
  );
}

function AgentMinimapDisclosure({
  currentIndex,
  model,
  onJump,
  onOpenChange,
  openSignal,
}: {
  readonly currentIndex: number;
  readonly model: AgentThreadMinimapModel;
  readonly openSignal: number;
  onJump(anchor: AgentThreadColumnAnchor): void;
  onOpenChange?(open: boolean): void;
}) {
  const { hide, onBlur, open, popoverRef, rootRef, show } = useAgentPopover("start");
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const placement = useAgentPopoverPlacement(open, anchorRef, popoverRef, "start");
  const handledSignal = useRef(openSignal);
  const openerRef = useRef<HTMLElement | null>(null);
  const escapedRef = useRef(false);
  const [focusSignal, setFocusSignal] = useState(0);

  useEffect(() => {
    if (openSignal === handledSignal.current) return;
    handledSignal.current = openSignal;
    if (open) {
      setFocusSignal((current) => current + 1);
      return;
    }
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    show();
  }, [open, openSignal, show]);

  useEffect(() => {
    onOpenChange?.(open);
    if (open) {
      setFocusSignal((current) => current + 1);
      return;
    }
    const opener = openerRef.current;
    const escaped = escapedRef.current;
    openerRef.current = null;
    escapedRef.current = false;
    if (!escaped || opener === null || !opener.isConnected) return;
    opener.focus({ preventScroll: true });
  }, [onOpenChange, open]);

  useEffect(
    () => () => {
      onOpenChange?.(false);
    },
    [onOpenChange],
  );

  const jump = useCallback(
    (anchor: AgentThreadColumnAnchor) => {
      hide(false);
      onJump(anchor);
    },
    [hide, onJump],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    escapedRef.current = true;
  };

  return (
    <div
      className="agent-minimap agent-minimap--compact"
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      ref={rootRef}
    >
      <span aria-hidden="true" className="agent-minimap__anchor" ref={anchorRef} />
      {open && (
        <nav
          aria-label="Your turns"
          className="agent-popover agent-minimap__popover"
          ref={popoverRef}
          style={placement.style}
        >
          <AgentTurnJumpList
            currentIndex={currentIndex}
            entries={model.entries}
            focusSignal={focusSignal}
            onJump={jump}
            surface="list"
          />
        </nav>
      )}
    </div>
  );
}

interface AgentTurnJumpListProps {
  readonly currentIndex: number;
  readonly entries: ReadonlyArray<AgentMinimapEntry>;
  readonly focusSignal: number;
  readonly surface: AgentMinimapSurface;
  onJump(anchor: AgentThreadColumnAnchor): void;
}

export function AgentTurnJumpList({
  currentIndex,
  entries,
  focusSignal,
  onJump,
  surface,
}: AgentTurnJumpListProps) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const { handlers, preview } = useAgentMinimapPreview(entries, surface === "rail");
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const handledSignal = useRef(focusSignal);
  const roving = boundedIndex(focusIndex ?? currentIndex, entries.length);

  const focusAt = useCallback((index: number): void => {
    setFocusIndex(index);
    listRef.current?.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
  }, []);

  useEffect(() => {
    if (focusSignal === handledSignal.current) return;
    handledSignal.current = focusSignal;
    focusAt(boundedIndex(currentIndex, entries.length));
  }, [currentIndex, entries.length, focusAt, focusSignal]);

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    const next = movedIndex(event.key, roving, entries.length);
    if (next === null) return;
    event.preventDefault();
    focusAt(next);
  };

  return (
    <>
      <ol
        {...handlers}
        className={`agent-minimap__list agent-minimap__list--${surface}`}
        onKeyDown={onKeyDown}
        ref={listRef}
      >
        {entries.map((entry, index) => (
          <AgentTurnJumpRow
            current={index === currentIndex}
            distance={agentMinimapDistance(index, currentIndex)}
            entry={entry}
            key={entry.key}
            onJump={onJump}
            surface={surface}
            tabbable={index === roving}
          />
        ))}
      </ol>
      {preview}
    </>
  );
}

const AgentTurnJumpRow = memo(function AgentTurnJumpRow({
  current,
  distance,
  entry,
  onJump,
  surface,
  tabbable,
}: {
  readonly current: boolean;
  readonly distance: number;
  readonly entry: AgentMinimapEntry;
  readonly surface: AgentMinimapSurface;
  readonly tabbable: boolean;
  onJump(anchor: AgentThreadColumnAnchor): void;
}) {
  const className = [
    "agent-minimap__dash",
    `agent-minimap__dash--${surface}`,
    entry.count > 1 ? "agent-minimap__dash--group" : null,
    entry.streaming ? "agent-minimap__dash--live" : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" ");

  return (
    <li className="agent-minimap__item">
      <button
        aria-busy={entry.streaming || undefined}
        aria-current={current || undefined}
        aria-label={entry.name}
        className={className}
        onClick={() => onJump(entry.anchor)}
        style={{ "--minimap-distance": distance } as CSSProperties}
        tabIndex={tabbable ? 0 : -1}
        type="button"
      >
        {surface === "list" && (
          <span className="agent-minimap__label">
            {entry.label}
            <small className="agent-minimap__caption">{entry.caption}</small>
          </span>
        )}
      </button>
    </li>
  );
});

function boundedIndex(index: number, length: number): number {
  if (length === 0) return 0;

  return Math.min(Math.max(index, 0), length - 1);
}

function movedIndex(key: string, current: number, length: number): number | null {
  if (length === 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return boundedIndex(current + 1, length);
  if (key === "ArrowUp" || key === "ArrowLeft") return boundedIndex(current - 1, length);
  if (key === "Home") return 0;
  if (key === "End") return length - 1;

  return null;
}
