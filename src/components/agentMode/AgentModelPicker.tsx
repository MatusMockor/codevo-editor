import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronDown, Search, Star } from "lucide-react";
import type { AgentModelFavorites } from "../../application/useAgentModelFavorites";
import type { AgentProviderManagementSurface } from "../../application/useAgentProviderManagement";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  agentLaunchModelHint,
  agentLaunchModelLabel,
  agentModelProviderName,
  agentModelRows,
  boundAgentModelQuery,
  filterAgentModelRows,
  MAX_AGENT_MODEL_QUERY_LENGTH,
  type AgentModelChoice,
  type AgentModelFilter,
  type AgentModelRow,
} from "./agentLaunchPresentation";
import { useAgentPopover } from "./agentPopover";
import { trapPopoverTab } from "./agentPopoverFocus";
import { AgentProviderGlyph } from "./AgentProviderGlyph";
import { agentPlatformModifier } from "./agentSubmitShortcut";

export interface AgentModelPickerProps {
  readonly id: string;
  readonly label: string;
  readonly launch: AgentLaunchOptions;
  readonly disabled: boolean;
  readonly describedBy: string | null;
  readonly favorites: AgentModelFavorites;
  readonly providerEnabled?: Readonly<Record<AgentCliKind, boolean>> | null;
  readonly providerManagement?: AgentProviderManagementSurface | null;
  onSelect(model: AgentModelChoice): void;
}

const PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];
const MAX_SHORTCUT_ROWS = 9;
const OTHER_PROVIDER_REASON = "Switch the agent CLI in settings";

export function AgentModelPicker({
  describedBy,
  disabled,
  favorites,
  id,
  label,
  launch,
  onSelect,
  providerEnabled = null,
  providerManagement = null,
}: AgentModelPickerProps) {
  const selectedProviderEnabled = providerIsEnabled(providerEnabled, launch.provider);
  const providerUnavailableReason = providerAvailabilityReason(
    providerManagement,
    launch.provider,
    selectedProviderEnabled,
  );
  const pickerDisabled = disabled || providerUnavailableReason !== null;
  const popover = useAgentPopover("start", pickerDisabled);
  const { hide, open, popoverRef, show } = popover;
  const [filter, setFilter] = useState<AgentModelFilter>("all");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = `${id}-list`;
  const dialogId = `${id}-dialog`;
  const rows = useMemo(
    () => (selectedProviderEnabled ? agentModelRows(launch.provider) : []),
    [launch.provider, selectedProviderEnabled],
  );
  const providers = useMemo(
    () => PROVIDERS.filter((provider) => providerIsEnabled(providerEnabled, provider)),
    [providerEnabled],
  );
  const visible = useMemo(
    () => filterAgentModelRows(rows, filter, favorites.keys, query),
    [favorites.keys, filter, query, rows],
  );
  const active = clampIndex(activeIndex, visible.length);
  const activeRow = visible[active] ?? null;
  const modifier = agentPlatformModifier().glyph;

  const openPicker = useCallback(() => {
    if (pickerDisabled) return;
    setQuery("");
    setFilter("all");
    setActiveIndex(
      Math.max(
        0,
        rows.findIndex((row) => row.value === launch.model),
      ),
    );
    show();
  }, [launch.model, pickerDisabled, rows, show]);

  const choose = useCallback(
    (row: AgentModelRow) => {
      if (pickerDisabled) return;
      hide(true);
      if (row.value === launch.model) return;
      onSelect(row.value);
    },
    [hide, launch.model, onSelect, pickerDisabled],
  );

  useLayoutEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || activeRow === null) return;
    const element = popoverRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    element?.scrollIntoView?.({ block: "nearest" });
  }, [active, activeRow, open, popoverRef]);

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    openPicker();
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const shortcut = shortcutIndex(event);
    if (shortcut !== null) {
      const row = visible[shortcut];
      if (row === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      choose(row);
      return;
    }
    const next = nextIndex(event.key, active, visible.length);
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex(next);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (query !== "") {
        setQuery("");
        return;
      }
      hide(true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (activeRow === null) return;
      choose(activeRow);
      return;
    }
    trapPopoverTab(event);
  };

  const selectFilter = (next: AgentModelFilter): void => {
    setFilter(next);
    setActiveIndex(0);
    searchRef.current?.focus();
  };

  return (
    <div
      className={`agent-picker agent-model-picker${open ? " agent-picker--open" : ""}`}
      data-placement={open ? popover.placement : undefined}
      onBlur={popover.onBlur}
      ref={popover.rootRef}
    >
      <button
        aria-controls={open ? dialogId : undefined}
        aria-describedby={describedBy ?? undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className="agent-picker__trigger agent-picker__trigger--ghost"
        data-value={launch.model}
        disabled={pickerDisabled}
        id={id}
        onClick={() => (open ? hide(false) : openPicker())}
        onKeyDown={onTriggerKeyDown}
        ref={popover.triggerRef}
        title={providerUnavailableReason ?? agentLaunchModelHint(launch)}
        type="button"
      >
        <span aria-hidden="true" className="agent-picker__icon">
          <AgentProviderGlyph kind={launch.provider} />
        </span>
        <span className="agent-picker__value">{agentLaunchModelLabel(launch)}</span>
        <ChevronDown aria-hidden="true" className="agent-picker__chevron" size={12} />
      </button>

      {open && (
        <div
          aria-label={label}
          className="agent-model-picker__dialog"
          id={dialogId}
          onKeyDown={onDialogKeyDown}
          ref={popoverRef}
          role="dialog"
          style={popover.style}
        >
          <div aria-label="Filter models" className="agent-model-picker__rail" role="group">
            <button
              aria-label="Favorite models"
              aria-pressed={filter === "favorites"}
              className="agent-model-picker__rail-item"
              onClick={() => selectFilter("favorites")}
              title="Favorites"
              type="button"
            >
              <Star aria-hidden="true" size={14} />
            </button>
            {providers.map((provider) => (
              <AgentProviderRailItem
                active={filter === "all"}
                current={provider === launch.provider}
                key={provider}
                onSelect={() => selectFilter("all")}
                provider={provider}
              />
            ))}
          </div>

          <div className="agent-model-picker__pane">
            <label className="agent-model-picker__search">
              <Search aria-hidden="true" size={13} />
              <input
                aria-activedescendant={activeRow === null ? undefined : optionId(listId, active)}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded="true"
                aria-label="Search models"
                autoComplete="off"
                className="agent-model-picker__input"
                maxLength={MAX_AGENT_MODEL_QUERY_LENGTH}
                onChange={(event) => {
                  setQuery(boundAgentModelQuery(event.target.value));
                  setActiveIndex(0);
                }}
                placeholder="Search models…"
                ref={searchRef}
                role="combobox"
                spellCheck={false}
                type="text"
                value={query}
              />
            </label>

            <div aria-label={label} className="agent-model-picker__list" id={listId} role="listbox">
              {visible.map((row, index) => (
                <div
                  className={`agent-model-picker__row${index === active ? " agent-model-picker__row--active" : ""}`}
                  key={row.favoriteKey}
                >
                  <div
                    aria-selected={row.value === launch.model}
                    className="agent-model-picker__option"
                    data-index={index}
                    data-value={row.value}
                    id={optionId(listId, index)}
                    onClick={() => choose(row)}
                    onMouseEnter={() => setActiveIndex(index)}
                    role="option"
                    title={row.hint}
                  >
                    <span aria-hidden="true" className="agent-model-picker__glyph">
                      <AgentProviderGlyph kind={row.provider} />
                    </span>
                    <span className="agent-model-picker__text">
                      <span className="agent-model-picker__label">{row.label}</span>
                      <span className="agent-model-picker__provider">{row.providerName}</span>
                    </span>
                    {index < MAX_SHORTCUT_ROWS && (
                      <kbd className="agent-model-picker__kbd agent-num">
                        {modifier}
                        {index + 1}
                      </kbd>
                    )}
                  </div>
                  <button
                    aria-label={favoriteLabel(row, favorites.isFavorite(row.favoriteKey))}
                    aria-pressed={favorites.isFavorite(row.favoriteKey)}
                    className="agent-model-picker__star"
                    onClick={() => favorites.toggle(row.favoriteKey)}
                    tabIndex={-1}
                    type="button"
                  >
                    <Star aria-hidden="true" size={13} />
                  </button>
                </div>
              ))}
              {visible.length === 0 && (
                <p className="agent-model-picker__empty" role="status">
                  {emptyMessage(filter, query)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentProviderRailItem({
  active,
  current,
  onSelect,
  provider,
}: {
  readonly provider: AgentCliKind;
  readonly current: boolean;
  readonly active: boolean;
  onSelect(): void;
}) {
  const name = agentModelProviderName(provider);
  if (!current) {
    return (
      <button
        aria-disabled="true"
        aria-label={`${name} models`}
        className="agent-model-picker__rail-item"
        data-provider={provider}
        title={OTHER_PROVIDER_REASON}
        type="button"
      >
        <AgentProviderGlyph kind={provider} />
      </button>
    );
  }
  return (
    <button
      aria-label={`${name} models`}
      aria-pressed={active}
      className="agent-model-picker__rail-item"
      data-provider={provider}
      onClick={onSelect}
      title={name}
      type="button"
    >
      <AgentProviderGlyph kind={provider} />
    </button>
  );
}

function favoriteLabel(row: AgentModelRow, favorite: boolean): string {
  if (favorite) return `Remove ${row.label} from favorites`;
  return `Add ${row.label} to favorites`;
}

function providerIsEnabled(
  enabled: Readonly<Record<AgentCliKind, boolean>> | null,
  provider: AgentCliKind,
): boolean {
  if (enabled === null) return true;
  return enabled[provider];
}

function providerAvailabilityReason(
  management: AgentProviderManagementSurface | null,
  provider: AgentCliKind,
  enabled: boolean,
): string | null {
  if (!enabled) return "Enable this provider in settings";
  if (management === null) return null;
  const disposition = management.admissionAuthority(provider).disposition;
  switch (disposition.kind) {
    case "ready":
      return null;
    case "disabled":
      return "This provider is disabled";
    case "updating":
      return "This provider is updating";
    case "policyUnavailable":
      return disposition.reason === "unregistered"
        ? "Provider policy is not registered"
        : "Provider policy registration failed";
    default:
      return unsupportedAdmissionDisposition(disposition);
  }
}

function unsupportedAdmissionDisposition(disposition: never): never {
  throw new TypeError(`Unsupported provider disposition: ${String(disposition)}`);
}

function emptyMessage(filter: AgentModelFilter, query: string): string {
  if (filter === "favorites" && query.trim() === "") {
    return "No favorite models yet. Star a model to pin it here.";
  }
  return "No models match your search.";
}

function optionId(listId: string, index: number): string {
  return `${listId}-${index}`;
}

function shortcutIndex(event: KeyboardEvent<HTMLElement>): number | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  if (event.altKey || event.shiftKey) return null;
  const digit = Number.parseInt(event.key, 10);
  if (!Number.isInteger(digit) || digit < 1 || digit > MAX_SHORTCUT_ROWS) return null;
  return digit - 1;
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

function nextIndex(key: string, index: number, length: number): number | null {
  if (length === 0) return null;
  if (key === "ArrowDown") return (index + 1) % length;
  if (key === "ArrowUp") return (index - 1 + length) % length;
  return null;
}
