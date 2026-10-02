import { Check, Folder, Search } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Popover } from "../../ui/foundation/Popover";
import type { AgentRailProjectFocus } from "../../domain/agentRailProjectFocus";
import { agentRailScopeState } from "./agentProjectMenuPresentation";
import { agentProjectBadgeMonogram, agentProjectMonogram } from "./agentProjectMonogram";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

const MAX_PROJECT_QUERY_CHARS = 160;
const SWITCHER_LABEL = "Switch project";
const ALL_PROJECTS_LABEL = "All projects";
const ALL_PROJECTS_KEY = "all";

interface SwitcherOption {
  readonly key: string;
  readonly label: string;
  readonly entry: AgentRailScopeEntry | null;
}

export interface AgentProjectSwitcherProps {
  readonly entries: ReadonlyArray<AgentRailScopeEntry>;
  readonly activeEntry: AgentRailScopeEntry | null;
  readonly focus: AgentRailProjectFocus;
  onSelectAll(): void;
  onSelectProject(projectRootKey: string): void;
}

export function AgentProjectSwitcher({
  activeEntry,
  entries,
  focus,
  onSelectAll,
  onSelectProject,
}: AgentProjectSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const options = useMemo(() => switcherOptions(entries, query), [entries, query]);
  const focused = focus === "active" && activeEntry !== null;
  const selectedKey = focused ? activeEntry.projectRootKey : ALL_PROJECTS_KEY;
  const active = options.length === 0 ? -1 : Math.min(highlight, options.length - 1);
  const triggerLabel =
    activeEntry === null ? SWITCHER_LABEL : `${SWITCHER_LABEL}: ${activeEntry.label}`;

  const close = (): void => {
    setOpen(false);
    setQuery("");
    setHighlight(0);
  };

  const choose = (option: SwitcherOption): void => {
    close();
    if (option.entry === null) {
      onSelectAll();
      return;
    }
    onSelectProject(option.entry.projectRootKey);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (options.length === 0 || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (active + step + options.length) % options.length;
      setHighlight(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: "nearest" });
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const option = options[active];
    if (option !== undefined) choose(option);
  };

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        className="cv-sb-switch"
        data-focused={focused ? "true" : undefined}
        data-open={open ? "true" : undefined}
        disabled={entries.length === 0}
        onClick={() => (open ? close() : setOpen(true))}
        ref={triggerRef}
        title={activeEntry?.label ?? ALL_PROJECTS_LABEL}
        type="button"
      >
        {activeEntry === null ? (
          <Folder aria-hidden="true" size={16} />
        ) : (
          <span aria-hidden="true" className="cv-sb-switch__badge">
            {agentProjectBadgeMonogram(activeEntry.label)}
          </span>
        )}
      </button>
      <Popover
        anchorRef={triggerRef}
        className="cv-switch"
        label={SWITCHER_LABEL}
        onClose={close}
        open={open}
        placement="bottom-end"
      >
        <label className="cv-switch__search">
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
        <ul aria-label="Projects" className="cv-switch__list" id={listId} role="listbox">
          {options.map((option, index) => (
            <SwitcherOptionRow
              active={index === active}
              current={
                option.entry !== null && option.entry.projectRootKey === activeEntry?.projectRootKey
              }
              id={`${listId}-${index}`}
              key={option.key}
              onChoose={() => choose(option)}
              onHighlight={() => setHighlight(index)}
              option={option}
              selected={option.key === selectedKey}
            />
          ))}
        </ul>
        {options.length === 0 && <p className="cv-switch__none">No matching projects.</p>}
      </Popover>
    </>
  );
}

interface SwitcherOptionRowProps {
  readonly option: SwitcherOption;
  readonly id: string;
  readonly active: boolean;
  readonly current: boolean;
  readonly selected: boolean;
  onChoose(): void;
  onHighlight(): void;
}

function SwitcherOptionRow({
  active,
  current,
  id,
  onChoose,
  onHighlight,
  option,
  selected,
}: SwitcherOptionRowProps) {
  const entry = option.entry;
  const state = entry === null ? null : (agentRailScopeState(entry)?.label ?? null);
  return (
    <li
      aria-selected={selected}
      className="cv-switch__option"
      data-current={current ? "true" : undefined}
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
      <span className="cv-switch__label" title={entry?.rootPath ?? option.label}>
        {option.label}
      </span>
      {state !== null && <span className="cv-switch__state">{state}</span>}
      {state === null && current && <span className="cv-switch__state">Current</span>}
      <Check aria-hidden="true" className="cv-switch__check" size={14} />
    </li>
  );
}

function switcherOptions(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  query: string,
): ReadonlyArray<SwitcherOption> {
  const needle = query.trim().toLocaleLowerCase();
  const projects = entries
    .filter((entry) => needle === "" || entry.label.toLocaleLowerCase().includes(needle))
    .map((entry) => ({ key: entry.projectRootKey, label: entry.label, entry }));
  if (needle !== "") return projects;
  return [{ key: ALL_PROJECTS_KEY, label: ALL_PROJECTS_LABEL, entry: null }, ...projects];
}
