import { Check, ChevronDown, Folder, ListFilter, Search, Settings } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "../../ui/foundation/IconButton";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";
import { Popover } from "../../ui/foundation/Popover";
import {
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  agentRailScopeState,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import { ALL_PROJECTS_LABEL, agentProjectMonogram, type AgentRailFilter } from "./agentRailFilter";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import "./agentSidebar.css";

const MAX_PROJECT_QUERY_CHARS = 160;
const FILTER_LABEL = "Filter threads by project";
const TRIGGER_TITLE = "Filters the thread list only. Doesn't change where you work.";

interface FilterOption {
  readonly key: string;
  readonly label: string;
  readonly entry: AgentRailScopeEntry | null;
}

export interface AgentProjectFilterMenuProps {
  readonly entries: ReadonlyArray<AgentRailScopeEntry>;
  readonly filter: AgentRailFilter;
  onSelectAll(): void;
  onSelectProject(entry: AgentRailScopeEntry): void;
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export function AgentProjectFilterMenu({
  entries,
  filter,
  onProjectCommand,
  onSelectAll,
  onSelectProject,
}: AgentProjectFilterMenuProps) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [actionsFor, setActionsFor] = useState<AgentRailScopeEntry | null>(null);
  const options = useMemo(() => filterOptions(entries, query), [entries, query]);
  const selectedKey = filter.kind === "all" ? "all" : filter.projectRootKey;
  const selected =
    filter.kind === "all"
      ? null
      : (entries.find((entry) => entry.projectRootKey === filter.projectRootKey) ?? null);
  const active = options.length === 0 ? -1 : Math.min(highlight, options.length - 1);
  const scopeLabel = selected === null ? ALL_PROJECTS_LABEL : selected.label;
  const triggerLabel = selected === null ? FILTER_LABEL : `${FILTER_LABEL}: ${selected.label}`;

  const close = (): void => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };

  const focusTrigger = (): void => {
    anchorRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  };

  const choose = (option: FilterOption): void => {
    close();
    if (option.entry === null) {
      onSelectAll();
      return;
    }
    onSelectProject(option.entry);
  };

  const openActions = (entry: AgentRailScopeEntry): void => {
    close();
    setActionsFor(entry);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (options.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((active + step + options.length) % options.length);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const option = options[active];
    if (option !== undefined) choose(option);
  };

  return (
    <>
      <span className="cv-sb-anchor" ref={anchorRef}>
        <button
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={triggerLabel}
          className="cv-sb-filter"
          data-open={open ? "true" : undefined}
          disabled={entries.length === 0}
          onClick={() => (open ? close() : setOpen(true))}
          title={TRIGGER_TITLE}
          type="button"
        >
          <ListFilter aria-hidden="true" size={12} />
          <span className="cv-sb-filter__name">{scopeLabel}</span>
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </span>
      <Popover
        anchorRef={anchorRef}
        className="cv-filter"
        label={FILTER_LABEL}
        onClose={close}
        open={open}
        placement="bottom-start"
      >
        <label className="cv-filter__search">
          <Search aria-hidden="true" size={14} />
          <input
            aria-activedescendant={active < 0 ? undefined : `${listId}-${active}`}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            aria-label="Search projects"
            autoComplete="off"
            autoFocus
            maxLength={MAX_PROJECT_QUERY_CHARS}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKeyDown}
            placeholder="Search projects..."
            role="combobox"
            spellCheck={false}
            value={query}
          />
        </label>
        <div className="cv-filter__rows">
          <ul aria-label="Projects" className="cv-filter__list" id={listId} role="listbox">
            {options.map((option, index) => (
              <FilterOptionRow
                active={index === active}
                id={`${listId}-${index}`}
                key={option.key}
                onChoose={() => choose(option)}
                onHighlight={() => setHighlight(index)}
                option={option}
                selected={option.key === selectedKey}
              />
            ))}
          </ul>
          <div aria-label="Project settings" className="cv-filter__gears" role="group">
            {options.map((option, index) => (
              <FilterGearSlot
                active={index === active}
                key={option.key}
                onHighlight={() => setHighlight(index)}
                onOpenActions={openActions}
                option={option}
              />
            ))}
          </div>
        </div>
        {options.length === 0 && <p className="cv-filter__none">No matching projects.</p>}
      </Popover>
      <Menu
        anchorRef={anchorRef}
        label={actionsFor === null ? "Project actions" : `Project actions for ${actionsFor.label}`}
        onClose={() => {
          setActionsFor(null);
          focusTrigger();
        }}
        open={actionsFor !== null}
        placement="bottom-start"
      >
        {actionsFor !== null &&
          agentProjectMenuEntries(actionsFor).map((item) => (
            <MenuItem
              disabled={item.disabled}
              key={item.id}
              onSelect={() => onProjectCommand(agentProjectMenuTarget(actionsFor), item.command)}
            >
              {item.label}
            </MenuItem>
          ))}
      </Menu>
    </>
  );
}

interface FilterOptionRowProps {
  readonly option: FilterOption;
  readonly id: string;
  readonly active: boolean;
  readonly selected: boolean;
  onChoose(): void;
  onHighlight(): void;
}

function FilterOptionRow({
  active,
  id,
  onChoose,
  onHighlight,
  option,
  selected,
}: FilterOptionRowProps) {
  const entry = option.entry;
  const state = entry === null ? null : agentRailScopeState(entry);
  return (
    <li
      aria-selected={selected}
      className="cv-filter__option"
      data-highlighted={active ? "true" : undefined}
      data-value={option.key}
      id={id}
      onClick={onChoose}
      onMouseMove={onHighlight}
      role="option"
    >
      {entry === null ? (
        <Folder aria-hidden="true" size={16} />
      ) : (
        <span aria-hidden="true" className="cv-favicon">
          {agentProjectMonogram(option.label)}
        </span>
      )}
      <span className="cv-filter__label" title={option.label}>
        {option.label}
      </span>
      {state !== null && <span className="cv-filter__state">{state.label}</span>}
      <Check aria-hidden="true" className="cv-filter__check" size={14} />
    </li>
  );
}

interface FilterGearSlotProps {
  readonly option: FilterOption;
  readonly active: boolean;
  onHighlight(): void;
  onOpenActions(entry: AgentRailScopeEntry): void;
}

function FilterGearSlot({ active, onHighlight, onOpenActions, option }: FilterGearSlotProps) {
  const entry = option.entry;
  if (entry === null) return <span aria-hidden="true" className="cv-filter__gear-slot" />;
  return (
    <span
      className="cv-filter__gear-slot"
      data-highlighted={active ? "true" : undefined}
      onMouseMove={onHighlight}
    >
      <IconButton
        className="cv-filter__gear"
        icon={<Settings size={14} />}
        label={`Project settings for ${option.label}`}
        onClick={() => onOpenActions(entry)}
        size="xs"
      />
    </span>
  );
}

function filterOptions(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  query: string,
): ReadonlyArray<FilterOption> {
  const needle = query.trim().toLocaleLowerCase();
  const projects = entries
    .filter((entry) => needle === "" || entry.label.toLocaleLowerCase().includes(needle))
    .map((entry) => ({ key: entry.projectRootKey, label: entry.label, entry }));
  if (needle !== "") return projects;
  return [{ key: "all", label: ALL_PROJECTS_LABEL, entry: null }, ...projects];
}
