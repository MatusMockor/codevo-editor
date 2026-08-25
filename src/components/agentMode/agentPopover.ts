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

export const AGENT_POPOVER_METRICS: AgentPopoverMetrics = {
  gap: 4,
  margin: 8,
  maxWidth: 320,
  maxHeight: 320,
  minHeight: 96,
};

export interface AgentPopoverHandle {
  readonly open: boolean;
  readonly placement: AgentPopoverPlacement;
  readonly style: CSSProperties;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly popoverRef: RefObject<HTMLDivElement | null>;
  show(): void;
  hide(restoreFocus: boolean): void;
  toggle(): void;
  onBlur(event: FocusEvent<HTMLElement>): void;
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
  metrics: AgentPopoverMetrics = AGENT_POPOVER_METRICS,
): AgentPopoverPosition {
  const height = Math.max(popover.scrollHeight, popover.offsetHeight);
  const roomBelow = viewport.height - anchor.bottom - metrics.gap - metrics.margin;
  const roomAbove = anchor.top - metrics.gap - metrics.margin;
  const up = roomBelow < height && roomAbove > roomBelow;
  const start = align === "start" ? anchor.left : viewport.width - anchor.right;
  return {
    placement: up ? "up" : "down",
    inset: clampInset(start, popover.offsetWidth, viewport.width, metrics.margin),
    offset: up ? viewport.height - anchor.top + metrics.gap : anchor.bottom + metrics.gap,
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

export function useAgentPopover(align: AgentPopoverAlign, disabled = false): AgentPopoverHandle {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<AgentPopoverPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const hide = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPosition(null);
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

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (trigger === null) return;
    const place = (): void => {
      const popover = popoverRef.current;
      if (popover === null) return;
      const next = agentPopoverPosition(trigger.getBoundingClientRect(), popover, align, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
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
  }, [align, open]);

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
    placement: position?.placement ?? "down",
    style: agentPopoverStyle(position, align),
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
