import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";
import { type AgentPickerOption, type AgentPickerTone } from "./agentPickerOption";
import { AgentCheckoutSearchInput, AgentCheckoutSearchPages } from "./AgentCheckoutSearchControls";
import { useCheckoutSearch } from "./useCheckoutSearch";
import { AgentPickerRows } from "./AgentPickerRows";
import { AGENT_POPOVER_METRICS, useAgentPopoverPlacement } from "./agentPopover";

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
  readonly menuLayout?: "default" | "checkout";
  readonly searchIdentity?: object;
  readonly searchSubject?: "repositories" | "branches";
  readonly icon?: ReactNode;
  readonly confirmation?: AgentPickerConfirmation | null;
  onChange(value: string): void;
  onOpen?(): void;
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
const CHECKOUT_POPOVER_METRICS = { ...AGENT_POPOVER_METRICS, maxHeight: 520 };

export function AgentPickerMenu({
  align,
  confirmation = null,
  describedBy,
  disabled,
  icon = null,
  id,
  label,
  menuLayout = "default",
  onChange,
  onOpen,
  options,
  prefix,
  searchIdentity,
  searchSubject = "repositories",
  tone,
  value,
  variant = "default",
}: AgentPickerMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const search = useCheckoutSearch(options, menuLayout === "checkout", open, searchIdentity);
  const visibleOptions = search.visibleOptions;
  const focusedIndex = clamp(activeIndex, visibleOptions.length);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const placement = useAgentPopoverPlacement(
    open,
    triggerRef,
    menuRef,
    align,
    menuLayout === "checkout" ? CHECKOUT_POPOVER_METRICS : AGENT_POPOVER_METRICS,
  );
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
      setActiveIndex(clamp(index, visibleOptions.length));
      setOpen(true);
      if (!open) onOpen?.();
    },
    [disabled, onOpen, open, options.length, visibleOptions.length],
  );

  const choose = useCallback(
    (option: AgentPickerOption) => {
      if (disabled) return;
      if (option.value === confirmation?.value && !confirmation.checked) {
        setActiveIndex(visibleOptions.indexOf(option));
        setOpen(true);
        if (option.value !== value) onChange(option.value);
        return;
      }
      close(true);
      if (option.value === value) return;
      onChange(option.value);
    },
    [close, confirmation, disabled, onChange, visibleOptions, value],
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
    const active = document.activeElement;
    if (
      search.enabled &&
      active instanceof HTMLElement &&
      (active.tagName === "INPUT" || active.tagName === "BUTTON") &&
      menuRef.current?.contains(active)
    )
      return;
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${focusedIndex}"]`)?.focus();
  }, [focusedIndex, open, search.enabled, visibleOptions]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    openMenu(selectedIndex);
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = nextIndex(event.key, focusedIndex, visibleOptions.length);
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(next);
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      if (!search.enabled) close(true);
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
    const option = visibleOptions[focusedIndex];
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
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={14} />
      </button>

      {open && (
        <div
          aria-label={search.enabled ? undefined : label}
          aria-multiselectable={
            search.enabled ? undefined : options.some((option) => option.selected) || undefined
          }
          className={`agent-picker__menu agent-picker__menu--${align}${menuLayout === "checkout" ? " agent-picker__menu--checkout" : ""}`}
          id={search.enabled ? undefined : listId}
          onKeyDown={onMenuKeyDown}
          ref={menuRef}
          role={search.enabled ? undefined : "listbox"}
          style={placement.style}
        >
          {search.enabled && (
            <AgentCheckoutSearchInput
              subject={searchSubject}
              query={search.query}
              listId={listId}
              onQuery={search.setQuery}
              onClose={() => close(true)}
              onFocusList={() => {
                const index = search.keyboardEntryIndex;
                if (index === null) return;
                setActiveIndex(index);
                menuRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
              }}
            />
          )}
          {search.enabled ? (
            <div
              role="listbox"
              id={listId}
              aria-label={label}
              aria-multiselectable="true"
              aria-busy={search.busy}
            >
              <AgentPickerRows
                options={visibleOptions}
                activeIndex={focusedIndex}
                value={value}
                listId={listId}
                menuLayout={menuLayout}
                confirmation={confirmation}
                onChoose={choose}
                onActiveIndex={setActiveIndex}
              />
            </div>
          ) : (
            <AgentPickerRows
              options={visibleOptions}
              activeIndex={focusedIndex}
              value={value}
              listId={listId}
              menuLayout={menuLayout}
              confirmation={confirmation}
              onChoose={choose}
              onActiveIndex={setActiveIndex}
            />
          )}
          {search.enabled && (
            <AgentCheckoutSearchPages
              subject={searchSubject}
              page={search.page}
              total={search.total}
              excluded={search.excluded}
              onPage={search.setPage}
              onClose={() => close(true)}
            />
          )}
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
