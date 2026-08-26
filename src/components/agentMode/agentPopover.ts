import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type RefObject,
} from "react";

export type AgentPopoverAlign = "start" | "end";
export type AgentPopoverPlacement = "down" | "up";

export interface AgentPopoverPosition {
  readonly placement: AgentPopoverPlacement;
  readonly inset: number;
  readonly offset: number;
  readonly minWidth: number;
  readonly maxHeight: number;
}

export interface AgentPopoverMetrics {
  readonly gap: number;
  readonly margin: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly minHeight: number;
}

export interface AgentPopoverViewport {
  readonly width: number;
  readonly height: number;
}

export interface AgentPopoverFrame {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

export interface AgentPopoverPlacementHandle {
  readonly placement: AgentPopoverPlacement;
  readonly style: CSSProperties;
}

export const AGENT_POPOVER_METRICS: AgentPopoverMetrics = {
  gap: 4,
  margin: 8,
  maxWidth: 320,
  maxHeight: 320,
  minHeight: 96,
};

export interface AgentPopoverHandle extends AgentPopoverPlacementHandle {
  readonly open: boolean;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly popoverRef: RefObject<HTMLDivElement | null>;
  show(): void;
  hide(restoreFocus: boolean): void;
  toggle(): void;
  onBlur(event: FocusEvent<HTMLElement>): void;
}

export function agentPopoverViewportFrame(viewport: AgentPopoverViewport): AgentPopoverFrame {
  return { top: 0, left: 0, right: viewport.width, bottom: viewport.height };
}

export function agentPopoverPosition(
  anchor: DOMRect,
  popover: {
    readonly offsetWidth: number;
    readonly offsetHeight: number;
    readonly scrollHeight: number;
  },
  align: AgentPopoverAlign,
  viewport: AgentPopoverViewport,
  frame: AgentPopoverFrame = agentPopoverViewportFrame(viewport),
  metrics: AgentPopoverMetrics = AGENT_POPOVER_METRICS,
): AgentPopoverPosition {
  const height = Math.max(popover.scrollHeight, popover.offsetHeight);
  const roomBelow = viewport.height - anchor.bottom - metrics.gap - metrics.margin;
  const roomAbove = anchor.top - metrics.gap - metrics.margin;
  const up = roomBelow < height && roomAbove > roomBelow;
  const start = align === "start" ? anchor.left : viewport.width - anchor.right;
  const inset = clampInset(start, popover.offsetWidth, viewport.width, metrics.margin);
  return {
    placement: up ? "up" : "down",
    inset: align === "start" ? inset - frame.left : inset - (viewport.width - frame.right),
    offset: up ? frame.bottom - anchor.top + metrics.gap : anchor.bottom + metrics.gap - frame.top,
    minWidth: Math.min(anchor.width, metrics.maxWidth),
    maxHeight: Math.max(metrics.minHeight, Math.min(metrics.maxHeight, up ? roomAbove : roomBelow)),
  };
}

export function agentPopoverStyle(
  position: AgentPopoverPosition | null,
  align: AgentPopoverAlign,
): CSSProperties {
  if (position === null) return {};
  const horizontal: CSSProperties =
    align === "start" ? { left: position.inset } : { right: position.inset };
  const vertical: CSSProperties =
    position.placement === "up" ? { bottom: position.offset } : { top: position.offset };
  return { minWidth: position.minWidth, maxHeight: position.maxHeight, ...horizontal, ...vertical };
}

export function samePopoverPosition(
  current: AgentPopoverPosition,
  next: AgentPopoverPosition,
): boolean {
  return (
    current.placement === next.placement &&
    current.inset === next.inset &&
    current.offset === next.offset &&
    current.minWidth === next.minWidth &&
    current.maxHeight === next.maxHeight
  );
}

export function agentPopoverContainingBlock(popover: HTMLElement): HTMLElement | null {
  let node = popover.parentElement;
  while (node !== null) {
    if (containsFixedDescendants(node)) return node;
    node = node.parentElement;
  }
  return null;
}

export function agentPopoverFrame(
  block: HTMLElement | null,
  viewport: AgentPopoverViewport,
): AgentPopoverFrame {
  if (block === null) return agentPopoverViewportFrame(viewport);
  const rect = block.getBoundingClientRect();
  const style = window.getComputedStyle(block);
  return {
    top: rect.top + edge(style.borderTopWidth),
    left: rect.left + edge(style.borderLeftWidth),
    right: rect.right - edge(style.borderRightWidth),
    bottom: rect.bottom - edge(style.borderBottomWidth),
  };
}

export function useAgentPopoverPlacement(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  popoverRef: RefObject<HTMLElement | null>,
  align: AgentPopoverAlign,
): AgentPopoverPlacementHandle {
  const [position, setPosition] = useState<AgentPopoverPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const trigger = triggerRef.current;
    if (trigger === null) return;
    let block: HTMLElement | null | undefined;
    const place = (): void => {
      const popover = popoverRef.current;
      if (popover === null) return;
      if (block === undefined) block = agentPopoverContainingBlock(popover);
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const next = agentPopoverPosition(
        trigger.getBoundingClientRect(),
        popover,
        align,
        viewport,
        agentPopoverFrame(block, viewport),
      );
      setPosition((current) =>
        current !== null && samePopoverPosition(current, next) ? current : next,
      );
    };
    place();
    const observer = observeSize(trigger, place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [align, open, popoverRef, triggerRef]);

  return { placement: position?.placement ?? "down", style: agentPopoverStyle(position, align) };
}

export function useAgentPopover(align: AgentPopoverAlign, disabled = false): AgentPopoverHandle {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const placement = useAgentPopoverPlacement(open, triggerRef, popoverRef, align);

  const hide = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (!restoreFocus) return;
    triggerRef.current?.focus();
  }, []);

  const show = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);

  const toggle = useCallback(() => {
    if (open) {
      hide(false);
      return;
    }
    show();
  }, [hide, open, show]);

  useEffect(() => {
    if (!disabled) return;
    hide(false);
  }, [disabled, hide]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      hide(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      hide(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [hide, open]);

  const onBlur = useCallback(
    (event: FocusEvent<HTMLElement>): void => {
      if (!open) return;
      const next = event.relatedTarget;
      if (!(next instanceof Node)) return;
      if (rootRef.current?.contains(next)) return;
      hide(false);
    },
    [hide, open],
  );

  return {
    open,
    placement: placement.placement,
    style: placement.style,
    rootRef,
    triggerRef,
    popoverRef,
    show,
    hide,
    toggle,
    onBlur,
  };
}

export function focusMenuItem(menu: HTMLElement | null, step: 1 | -1 | 0): void {
  if (menu === null) return;
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
  if (items.length === 0) return;
  if (step === 0) {
    items[0]?.focus();
    return;
  }
  const current = items.findIndex((item) => item === document.activeElement);
  items[(current + step + items.length) % items.length]?.focus();
}

const CONTAINING_BLOCK_CONTAIN = ["strict", "content", "paint", "layout"];
const CONTAINING_BLOCK_WILL_CHANGE = [
  "transform",
  "translate",
  "rotate",
  "scale",
  "perspective",
  "filter",
  "contain",
];

function containsFixedDescendants(node: HTMLElement): boolean {
  const style = window.getComputedStyle(node);
  if (isSet(style.transform)) return true;
  if (isSet(style.translate)) return true;
  if (isSet(style.rotate)) return true;
  if (isSet(style.scale)) return true;
  if (isSet(style.perspective)) return true;
  if (isSet(style.filter)) return true;
  if (isSet(style.backdropFilter)) return true;
  if (style.containerType !== undefined && isSet(style.containerType)) return true;
  if (CONTAINING_BLOCK_CONTAIN.some((value) => style.contain.split(" ").includes(value))) {
    return true;
  }
  return CONTAINING_BLOCK_WILL_CHANGE.some((value) =>
    style.willChange.split(/[,\s]+/).includes(value),
  );
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "none" && value !== "normal";
}

function edge(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function observeSize(element: HTMLElement, place: () => void): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") return null;
  const observer = new ResizeObserver(() => place());
  observer.observe(element);
  return observer;
}

function clampInset(inset: number, width: number, viewportWidth: number, margin: number): number {
  const limit = Math.max(margin, viewportWidth - margin - width);
  return Math.min(Math.max(inset, margin), limit);
}
