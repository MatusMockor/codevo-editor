import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./classNames";
import { useRestoreFocus } from "./useRestoreFocus";
import "./commandList.css";

export interface CommandSurfaceProps {
  readonly label: string;
  readonly children: ReactNode;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
}

export function CommandSurface(props: CommandSurfaceProps) {
  return createPortal(<CommandSurfaceFrame {...props} />, document.body);
}

function CommandSurfaceFrame({ children, label, onClose, returnFocusRef }: CommandSurfaceProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useRestoreFocus(returnFocusRef, dialogRef);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  const keepFocus = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
  };
  const dismiss = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    onClose();
  };
  return (
    <div className="cv-command-layer" onKeyDown={handleKeyDown}>
      <div aria-hidden="true" className="cv-command-backdrop" />
      <div className="cv-command-viewport" onMouseDown={keepFocus} onPointerDown={dismiss}>
        <div
          aria-label={label}
          aria-modal="true"
          className="cv-command"
          ref={dialogRef}
          role="dialog"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export type CommandInputLead = "search" | "back";

export interface CommandInputProps {
  readonly value: string;
  readonly placeholder: string;
  readonly label: string;
  readonly listboxId: string;
  readonly activeDescendantId: string | null;
  readonly expanded: boolean;
  readonly lead?: CommandInputLead;
  readonly leadIcon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  onChange(value: string): void;
  onKeyDown?(event: KeyboardEvent<HTMLInputElement>): void;
  onBack?(): void;
  onCompositionStart?(): void;
  onCompositionEnd?(value: string): void;
}

export function CommandInput({
  activeDescendantId,
  expanded,
  inputRef,
  label,
  lead = "search",
  leadIcon,
  listboxId,
  onBack,
  onChange,
  onCompositionEnd,
  onCompositionStart,
  onKeyDown,
  placeholder,
  trailing,
  value,
}: CommandInputProps) {
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [ref]);
  return (
    <div className="cv-command-input">
      <div className="cv-command-field">
        <CommandInputLeadView lead={lead} leadIcon={leadIcon} onBack={onBack} />
        <input
          aria-activedescendant={expanded ? (activeDescendantId ?? undefined) : undefined}
          aria-autocomplete="list"
          aria-controls={expanded ? listboxId : undefined}
          aria-expanded={expanded}
          aria-label={label}
          autoComplete="off"
          onChange={(event) => onChange(event.currentTarget.value)}
          onCompositionEnd={(event) => onCompositionEnd?.(event.currentTarget.value)}
          onCompositionStart={() => onCompositionStart?.()}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          ref={ref}
          role="combobox"
          spellCheck={false}
          type="text"
          value={value}
        />
        {trailing === undefined ? null : (
          <span className="cv-command-field__trailing">{trailing}</span>
        )}
      </div>
    </div>
  );
}

function CommandInputLeadView({
  lead,
  leadIcon,
  onBack,
}: {
  readonly lead: CommandInputLead;
  readonly leadIcon: ReactNode;
  onBack?(): void;
}) {
  if (lead === "back") {
    return (
      <button
        aria-label="Back"
        className="cv-command-lead cv-command-lead--back"
        onClick={() => onBack?.()}
        onMouseDown={(event) => event.preventDefault()}
        tabIndex={-1}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={16} />
      </button>
    );
  }
  return (
    <span aria-hidden="true" className="cv-command-lead">
      {leadIcon ?? <Search size={16} />}
    </span>
  );
}

export function CommandPanel({ children }: { readonly children: ReactNode }) {
  return <div className="cv-command-panel">{children}</div>;
}

export function CommandList({
  children,
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div aria-label={label} className="cv-command-list" id={id} role="listbox">
      {children}
    </div>
  );
}

export function CommandGroup({
  children,
  label,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const labelId = useId();
  return (
    <div aria-labelledby={labelId} className="cv-command-group" role="group">
      <div className="cv-command-group__label" id={labelId}>
        {label}
      </div>
      {children}
    </div>
  );
}

export interface CommandItemProps {
  readonly id: string;
  readonly active: boolean;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly trailing?: ReactNode;
  readonly timestamp?: string;
  readonly shortcut?: string;
  readonly submenu?: boolean;
  readonly disabled?: boolean;
  readonly hint?: string;
  onSelect(): void;
  onHover(): void;
}

export function CommandItem({
  active,
  description,
  disabled = false,
  hint,
  icon,
  id,
  onHover,
  onSelect,
  shortcut,
  submenu = false,
  timestamp,
  title,
  trailing,
}: CommandItemProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div
      aria-disabled={disabled ? true : undefined}
      aria-selected={active}
      className={cx("cv-command-item", disabled && "cv-command-item--disabled")}
      id={id}
      onClick={() => {
        if (disabled) return;
        onSelect();
      }}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (active) return;
        onHover();
      }}
      ref={ref}
      role="option"
      title={hint}
    >
      {icon === undefined ? null : (
        <span aria-hidden="true" className="cv-command-item__icon">
          {icon}
        </span>
      )}
      <span className="cv-command-item__text">
        <span className="cv-command-item__title">{title}</span>
        {description === undefined ? null : (
          <span className="cv-command-item__description">{description}</span>
        )}
      </span>
      {trailing === undefined ? null : (
        <span className="cv-command-item__trailing">{trailing}</span>
      )}
      {timestamp === undefined ? null : (
        <span className="cv-command-item__timestamp">{timestamp}</span>
      )}
      {shortcut === undefined ? null : <kbd className="cv-command-item__shortcut">{shortcut}</kbd>}
      {submenu ? (
        <ChevronRight aria-hidden="true" className="cv-command-item__chevron" size={16} />
      ) : null}
    </div>
  );
}

export function CommandResultsStatus({
  count,
  message,
}: {
  readonly count: number;
  readonly message?: string;
}) {
  return (
    <div aria-live="polite" className="cv-command-live" role="status">
      {message ?? resultsMessage(count)}
    </div>
  );
}

function resultsMessage(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "1 result";
  return `${count} results`;
}

export function CommandEmpty({ children }: { readonly children: ReactNode }) {
  return (
    <div className="cv-command-empty" role="status">
      {children}
    </div>
  );
}

export function CommandFooter({
  children,
  end,
}: {
  readonly children: ReactNode;
  readonly end?: ReactNode;
}) {
  return (
    <div aria-hidden="true" className="cv-command-footer">
      {children}
      {end === undefined ? null : <span className="cv-command-footer__end">{end}</span>}
    </div>
  );
}

export function CommandFooterHint({
  keys,
  label,
}: {
  readonly keys: readonly string[];
  readonly label: string;
}) {
  return (
    <span className="cv-command-hint">
      {keys.map((key, index) => (
        <span className="cv-command-kbd" key={`${index}-${key}`}>
          {key}
        </span>
      ))}
      <span>{label}</span>
    </span>
  );
}
