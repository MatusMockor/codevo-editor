import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import type { AgentPickerOption, AgentPickerTone } from "./agentPickerOption";
import { useAgentPopoverPlacement } from "./agentPopover";

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
  readonly confirmation?: AgentPickerConfirmation | null;
  onChange(value: string): void;
}

export interface AgentPickerConfirmation {
  readonly id: string;
  readonly value: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly label: string;
  readonly description: string | null;
  onChange(checked: boolean): void;
}

const UNKNOWN_VALUE_LABEL = "Select…";

export function AgentPickerMenu({
  align,
  confirmation = null,
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const placement = useAgentPopoverPlacement(open, triggerRef, menuRef, align);
  const listId = `${id}-list`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex < 0 ? null : (options[selectedIndex] ?? null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
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
      if (option.value === confirmation?.value && !confirmation.checked) {
        setActiveIndex(options.indexOf(option));
        setOpen(true);
        if (option.value !== value) onChange(option.value);
        return;
      }
      close(true);
      if (option.value === value) return;
      onChange(option.value);
    },
    [close, confirmation, disabled, onChange, options, value],
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
      data-placement={open ? placement.placement : undefined}
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
          style={placement.style}
        >
          {options.map((option, index) => (
            <Fragment key={option.value}>
              <div
                aria-selected={option.value === value}
                className={optionClassName(option, index === activeIndex)}
                data-index={index}
                data-value={option.value}
                id={`${listId}-${index}`}
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
                      <TriangleAlert
                        aria-hidden="true"
                        className="agent-picker__warn"
                        size={11}
                      />
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
              {confirmation !== null &&
                option.value === value &&
                option.value === confirmation.value && (
                  <label className="agent-picker__confirmation" htmlFor={confirmation.id}>
                    <input
                      checked={confirmation.checked}
                      disabled={confirmation.disabled}
                      id={confirmation.id}
                      onChange={(event) => confirmation.onChange(event.target.checked)}
                      type="checkbox"
                    />
                    <span className="agent-picker__confirmation-copy">
                      <span className="agent-picker__confirmation-label">
                        {confirmation.label}
                      </span>
                      {confirmation.description !== null && (
                        <span className="agent-picker__confirmation-description">
                          {confirmation.description}
                        </span>
                      )}
                    </span>
                  </label>
                )}
            </Fragment>
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
