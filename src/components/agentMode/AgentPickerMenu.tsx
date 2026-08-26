import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import type { AgentPickerOption, AgentPickerTone } from "./agentPickerOption";

export type { AgentPickerOption, AgentPickerTone } from "./agentPickerOption";

export type AgentPickerAlign = "start" | "end";

export type AgentPickerVariant = "default" | "ghost";

export interface AgentPickerMenuProps {
  readonly id: string;
  readonly label: string;
  readonly options: ReadonlyArray<AgentPickerOption>;
  readonly value: string;
  readonly disabled: boolean;
  readonly tone: AgentPickerTone;
  readonly prefix: string | null;
  readonly describedBy: string | null;
  readonly align: AgentPickerAlign;
  readonly variant?: AgentPickerVariant;
  readonly icon?: ReactNode;
  onChange(value: string): void;
}

type Placement = "down" | "up";

interface MenuPosition {
  readonly placement: Placement;
  readonly inset: number;
  readonly offset: number;
  readonly minWidth: number;
  readonly maxHeight: number;
}

const MENU_GAP = 4;
const MENU_MARGIN = 8;
const MENU_MAX_WIDTH = 320;
const MENU_MAX_HEIGHT = 320;
const MENU_MIN_HEIGHT = 96;
const UNKNOWN_VALUE_LABEL = "Select…";

export function AgentPickerMenu({
  align,
  describedBy,
  disabled,
  icon = null,
  id,
  label,
  onChange,
  options,
  prefix,
  tone,
  value,
  variant = "default",
}: AgentPickerMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = `${id}-list`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex < 0 ? null : (options[selectedIndex] ?? null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    setPosition(null);
    if (!restoreFocus) return;
    triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(
    (index: number) => {
      if (disabled || options.length === 0) return;
      setActiveIndex(clamp(index, options.length));
      setOpen(true);
    },
    [disabled, options.length],
  );

  const choose = useCallback(
    (option: AgentPickerOption) => {
      if (disabled) return;
      close(true);
      if (option.value === value) return;
      onChange(option.value);
    },
    [close, disabled, onChange, value],
  );

  useEffect(() => {
    if (!disabled) return;
    close(false);
  }, [close, disabled]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [close, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (trigger === null) return;
    const place = (): void => {
      const menu = menuRef.current;
      if (menu === null) return;
      const next = menuPosition(trigger.getBoundingClientRect(), menu, align);
      setPosition((current) => (current !== null && samePosition(current, next) ? current : next));
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

  useLayoutEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.focus();
  }, [activeIndex, open]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(selectedIndex);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextIndex(event.key, activeIndex, options.length);
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(next);
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    const option = options[activeIndex];
    if (option === undefined) return;
    choose(option);
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!open) return;
    const next = event.relatedTarget;
    if (!(next instanceof Node)) return;
    if (rootRef.current?.contains(next)) return;
    close(false);
  };

  return (
    <div
      className={`agent-picker${open ? " agent-picker--open" : ""}`}
      data-placement={open ? (position?.placement ?? "down") : undefined}
      onBlur={onBlur}
      ref={rootRef}
    >
      <button
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy ?? undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className={triggerClassName(tone, variant)}
        data-value={value}
        disabled={disabled}
        id={id}
        onClick={() => (open ? close(false) : openMenu(selectedIndex))}
        onKeyDown={onTriggerKeyDown}
        ref={triggerRef}
        title={selected?.description ?? undefined}
        type="button"
      >
        {icon !== null && (
          <span aria-hidden="true" className="agent-picker__icon">
            {icon}
          </span>
        )}
        {prefix !== null && <span className="agent-picker__prefix">{prefix}:</span>}
        <span className="agent-picker__value">{selected?.label ?? UNKNOWN_VALUE_LABEL}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={12} />
      </button>

      {open && (
        <div
          aria-label={label}
          className={`agent-picker__menu agent-picker__menu--${align}`}
          id={listId}
          onKeyDown={onMenuKeyDown}
          ref={menuRef}
          role="listbox"
          style={menuStyle(position, align)}
        >
          {options.map((option, index) => (
            <div
              aria-selected={option.value === value}
              className={optionClassName(option, index === activeIndex)}
              data-index={index}
              data-value={option.value}
              id={`${listId}-${index}`}
              key={option.value}
              onClick={() => choose(option)}
              onMouseEnter={() => setActiveIndex(index)}
              role="option"
              tabIndex={-1}
            >
              <span className="agent-picker__mark" aria-hidden="true">
                {option.value === value && <Check size={12} />}
              </span>
              <span className="agent-picker__text">
                <span className="agent-picker__label">
                  {option.tone === "danger" && (
                    <TriangleAlert aria-hidden="true" className="agent-picker__warn" size={11} />
                  )}
                  {option.label}
                  {option.detail !== null && (
                    <span className="agent-picker__detail agent-num">{option.detail}</span>
                  )}
                </span>
                {option.description !== null && (
                  <span className="agent-picker__description">{option.description}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function triggerClassName(tone: AgentPickerTone, variant: AgentPickerVariant): string {
  const classes = ["agent-picker__trigger"];
  if (variant === "ghost") classes.push("agent-picker__trigger--ghost");
  if (tone !== null) classes.push(`agent-picker__trigger--${tone}`);
  return classes.join(" ");
}

function optionClassName(option: AgentPickerOption, active: boolean): string {
  const classes = ["agent-picker__option"];
  if (active) classes.push("agent-picker__option--active");
  if (option.tone !== null) classes.push(`agent-picker__option--${option.tone}`);
  return classes.join(" ");
}

function observeSize(element: HTMLElement, place: () => void): ResizeObserver | null {
  if (typeof ResizeObserver === "undefined") return null;
  const observer = new ResizeObserver(() => place());
  observer.observe(element);
  return observer;
}

function menuPosition(rect: DOMRect, menu: HTMLElement, align: AgentPickerAlign): MenuPosition {
  const height = Math.max(menu.scrollHeight, menu.offsetHeight);
  const roomBelow = window.innerHeight - rect.bottom - MENU_GAP - MENU_MARGIN;
  const roomAbove = rect.top - MENU_GAP - MENU_MARGIN;
  const up = roomBelow < height && roomAbove > roomBelow;
  const anchor = align === "start" ? rect.left : window.innerWidth - rect.right;
  return {
    placement: up ? "up" : "down",
    inset: clampInset(anchor, menu.offsetWidth),
    offset: up ? window.innerHeight - rect.top + MENU_GAP : rect.bottom + MENU_GAP,
    minWidth: Math.min(rect.width, MENU_MAX_WIDTH),
    maxHeight: Math.max(MENU_MIN_HEIGHT, Math.min(MENU_MAX_HEIGHT, up ? roomAbove : roomBelow)),
  };
}

function menuStyle(position: MenuPosition | null, align: AgentPickerAlign): CSSProperties {
  if (position === null) return {};
  const horizontal: CSSProperties =
    align === "start" ? { left: position.inset } : { right: position.inset };
  const vertical: CSSProperties =
    position.placement === "up" ? { bottom: position.offset } : { top: position.offset };
  return {
    minWidth: position.minWidth,
    maxHeight: position.maxHeight,
    ...horizontal,
    ...vertical,
  };
}

function samePosition(current: MenuPosition, next: MenuPosition): boolean {
  return (
    current.placement === next.placement &&
    current.inset === next.inset &&
    current.offset === next.offset &&
    current.minWidth === next.minWidth &&
    current.maxHeight === next.maxHeight
  );
}

function clampInset(inset: number, menuWidth: number): number {
  const limit = Math.max(MENU_MARGIN, window.innerWidth - MENU_MARGIN - menuWidth);
  return Math.min(Math.max(inset, MENU_MARGIN), limit);
}

function clamp(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

function nextIndex(key: string, index: number, length: number): number | null {
  if (length === 0) return null;
  if (key === "ArrowDown") return (index + 1) % length;
  if (key === "ArrowUp") return (index - 1 + length) % length;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  return null;
}
