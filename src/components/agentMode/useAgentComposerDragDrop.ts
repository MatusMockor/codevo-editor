import { useContext, useEffect, useRef, useState, type RefObject } from "react";
import type {
  AgentComposerDragDropEvent,
  AgentComposerDragDropSubscribe,
} from "./agentComposerAttachmentPorts";
import {
  AgentAttachmentDropZoneContext,
  type AgentAttachmentDropZone,
} from "./agentAttachmentDropZone";

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
  const zone = useContext(AgentAttachmentDropZoneContext);
  const [over, setOver] = useState(false);
  const dropRef = useRef(onDropPaths);
  dropRef.current = onDropPaths;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  const listening = enabled && zoneIsAvailable(zone);

  useEffect(() => {
    if (!listening) {
      setOver(false);
      return;
    }
    let current = true;
    let unlisten: (() => void) | null = null;
    void subscribe((event) => {
      if (!current) return;
      const inside = eventIsInside(event, dropBounds(zone, targetRef));
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
  }, [listening, subscribe, targetRef, zone]);

  useEffect(() => {
    if (!over || zone === null) return;
    return zone.showOverlay();
  }, [over, zone]);

  return over && zone === null;
}

function zoneIsAvailable(zone: AgentAttachmentDropZone | null): boolean {
  if (zone === null) return true;
  return zone.available;
}

function dropBounds(
  zone: AgentAttachmentDropZone | null,
  targetRef: RefObject<HTMLElement | null>,
): HTMLElement | null {
  if (zone === null) return targetRef.current;
  return zone.columnRef.current;
}

function eventIsInside(event: AgentComposerDragDropEvent, target: HTMLElement | null): boolean {
  if (target === null) return false;
  if (target.closest("[inert], [hidden]") !== null) return false;
  const bounds = target.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return false;
  if (event.x < bounds.left || event.x > bounds.right) return false;
  if (event.y < bounds.top || event.y > bounds.bottom) return false;
  return isTopmostAt(target, event.x, event.y);
}

function isTopmostAt(target: HTMLElement, x: number, y: number): boolean {
  const topmost = target.ownerDocument.elementFromPoint(x, y);
  if (topmost === null) return false;
  return target.contains(topmost);
}
