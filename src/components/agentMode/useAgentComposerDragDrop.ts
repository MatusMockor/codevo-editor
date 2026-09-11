import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  AgentComposerDragDropEvent,
  AgentComposerDragDropSubscribe,
} from "./agentComposerAttachmentPorts";

export interface AgentComposerDragDropOptions {
  readonly enabled: boolean;
  readonly subscribe: AgentComposerDragDropSubscribe;
  readonly targetRef: RefObject<HTMLElement | null>;
  onDropPaths(paths: ReadonlyArray<string>): void;
  onUnavailable?(): void;
}

export function useAgentComposerDragDrop({
  enabled,
  subscribe,
  targetRef,
  onDropPaths,
  onUnavailable,
}: AgentComposerDragDropOptions): boolean {
  const [over, setOver] = useState(false);
  const dropRef = useRef(onDropPaths);
  dropRef.current = onDropPaths;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!enabled) {
      setOver(false);
      return;
    }
    let current = true;
    let unlisten: (() => void) | null = null;
    void subscribe((event) => {
      if (!current) return;
      const inside = eventIsInside(event, targetRef.current);
      if (event.kind === "leave") {
        setOver(false);
        return;
      }
      if (event.kind === "over") {
        setOver(inside);
        return;
      }
      setOver(false);
      if (!inside) return;
      if (event.paths.length === 0) return;
      dropRef.current(event.paths);
    })
      .then((stop) => {
        if (!current) {
          stop();
          return;
        }
        unlisten = stop;
      })
      .catch(() => {
        if (!current) return;
        unavailableRef.current?.();
      });
    return () => {
      current = false;
      unlisten?.();
    };
  }, [enabled, subscribe, targetRef]);

  return over;
}

function eventIsInside(event: AgentComposerDragDropEvent, target: HTMLElement | null): boolean {
  if (target === null) return false;
  const bounds = target.getBoundingClientRect();
  if (bounds.width === 0 && bounds.height === 0) return false;
  if (event.x < bounds.left || event.x > bounds.right) return false;
  return event.y >= bounds.top && event.y <= bounds.bottom;
}
