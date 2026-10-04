import { Check, Folder, Search, Server, Settings, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { IconButton } from "../../ui/foundation/IconButton";
import { Menu } from "../../ui/foundation/Menu";
import { MenuItem } from "../../ui/foundation/MenuItem";
import { Popover } from "../../ui/foundation/Popover";
import type { AgentRailProjectFocus } from "../../domain/agentRailProjectFocus";
import { AgentProjectBadge } from "./AgentProjectBadge";
import {
  agentProjectClosable,
  agentProjectCloseLabel,
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  agentRailProjectState,
  type AgentProjectMenuCommand,
  type AgentProjectMenuTarget,
} from "./agentProjectMenuPresentation";
import { agentProjectServerBadgeLabel } from "./agentProjectServerPresence";
import { useAgentRowServerNames, type AgentRowServerNames } from "./agentRowServerNamesContext";
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
  onProjectCommand(target: AgentProjectMenuTarget, command: AgentProjectMenuCommand): void;
}

export function AgentProjectSwitcher({
  activeEntry,
  entries,
  focus,
  onProjectCommand,
  onSelectAll,
  onSelectProject,
}: AgentProjectSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [actionsFor, setActionsFor] = useState<AgentRailScopeEntry | null>(null);
  const options = useMemo(() => switcherOptions(entries, query), [entries, query]);
  const serverNames = useAgentRowServerNames();
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

  const openActions = (entry: AgentRailScopeEntry): void => {
    close();
    setActionsFor(entry);
  };

  const closeProject = (entry: AgentRailScopeEntry): void => {
    if (entries.length <= 1) {
      close();
      triggerRef.current?.focus();
    }
    if (entries.length > 1) searchRef.current?.focus();
    onProjectCommand(agentProjectMenuTarget(entry), "close");
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
          <AgentProjectBadge label={activeEntry.label} />
        )}
      </button>
      <Popover
        anchorRef={triggerRef}
        className="cv-project-switch"
        label={SWITCHER_LABEL}
        onClose={close}
        open={open}
        placement="bottom-end"
      >
        <label className="cv-project-switch__search">
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
            ref={searchRef}
            role="combobox"
            spellCheck={false}
            value={query}
          />
        </label>
        <div className="cv-project-switch__rows">
          <ul aria-label="Projects" className="cv-project-switch__list" id={listId} role="listbox">
            {options.map((option, index) => (
              <SwitcherOptionRow
                active={index === active}
                current={
                  option.entry !== null &&
                  option.entry.projectRootKey === activeEntry?.projectRootKey
                }
                id={`${listId}-${index}`}
                key={option.key}
                onChoose={() => choose(option)}
                onHighlight={() => setHighlight(index)}
                option={option}
                selected={option.key === selectedKey}
                serverNames={serverNames}
              />
            ))}
          </ul>
          <div aria-label="Project actions" className="cv-project-switch__gears" role="group">
            {options.map((option, index) => (
              <SwitcherGearSlot
                active={index === active}
                key={option.key}
                onCloseProject={closeProject}
                onHighlight={() => setHighlight(index)}
                onOpenActions={openActions}
                option={option}
              />
            ))}
          </div>
        </div>
        {options.length === 0 && <p className="cv-project-switch__none">No matching projects.</p>}
      </Popover>
      <Menu
        anchorRef={triggerRef}
        label={actionsFor === null ? "Project actions" : `Project actions for ${actionsFor.label}`}
        onClose={() => setActionsFor(null)}
        open={actionsFor !== null}
        placement="bottom-end"
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

interface SwitcherOptionRowProps {
  readonly option: SwitcherOption;
  readonly id: string;
  readonly active: boolean;
  readonly current: boolean;
  readonly selected: boolean;
  readonly serverNames: AgentRowServerNames;
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
  serverNames,
}: SwitcherOptionRowProps) {
  const entry = option.entry;
  const state = entry === null ? null : agentRailProjectState(entry);
  const serverLabel =
    entry === null ? null : agentProjectServerBadgeLabel(entry.serverPresence, serverNames);
  return (
    <li
      aria-current={current ? "true" : undefined}
      aria-selected={selected}
      className="cv-project-switch__option"
      data-current={current ? "true" : undefined}
      data-highlighted={active ? "true" : undefined}
      data-value={option.key}
      id={id}
      onClick={onChoose}
      onMouseMove={onHighlight}
      role="option"
    >
      {entry === null ? (
        <span aria-hidden="true" className="cv-project-switch__all">
          <Folder size={16} />
        </span>
      ) : (
        <AgentProjectBadge label={option.label} />
      )}
      <span className="cv-project-switch__label" title={entry?.rootPath ?? option.label}>
        {option.label}
      </span>
      {serverLabel !== null && (
        <span className="cv-project-switch__server" title={serverLabel}>
          <Server aria-hidden="true" size={13} />
          <span className="agent-visually-hidden">{serverLabel}</span>
        </span>
      )}
      {current && <span className="cv-project-switch__state">Current</span>}
      {!current && state !== null && <span className="cv-project-switch__state">{state}</span>}
      <Check aria-hidden="true" className="cv-project-switch__check" size={14} />
    </li>
  );
}

interface SwitcherGearSlotProps {
  readonly option: SwitcherOption;
  readonly active: boolean;
  onCloseProject(entry: AgentRailScopeEntry): void;
  onHighlight(): void;
  onOpenActions(entry: AgentRailScopeEntry): void;
}

function SwitcherGearSlot({
  active,
  onCloseProject,
  onHighlight,
  onOpenActions,
  option,
}: SwitcherGearSlotProps) {
  const entry = option.entry;
  if (entry === null) return <span aria-hidden="true" className="cv-project-switch__gear-slot" />;
  return (
    <span
      className="cv-project-switch__gear-slot"
      data-highlighted={active ? "true" : undefined}
      onMouseMove={onHighlight}
    >
      {agentProjectClosable(entry) && (
        <IconButton
          className="cv-project-switch__close"
          icon={<X size={14} />}
          label={agentProjectCloseLabel(entry)}
          onClick={() => onCloseProject(entry)}
          size="xs"
          title="Close project"
        />
      )}
      <IconButton
        className="cv-project-switch__gear"
        icon={<Settings size={14} />}
        label={`Project settings for ${option.label}`}
        onClick={() => onOpenActions(entry)}
        size="xs"
      />
    </span>
  );
}

function switcherOptions(
  entries: ReadonlyArray<AgentRailScopeEntry>,
  query: string,
): ReadonlyArray<SwitcherOption> {
  const needle = query.trim().toLocaleLowerCase();
  const projects = entries
    .filter((entry) => needle === "" || switcherEntryMatches(entry, needle))
    .map((entry) => ({ key: entry.projectRootKey, label: entry.label, entry }));
  if (needle !== "") return projects;
  return [{ key: ALL_PROJECTS_KEY, label: ALL_PROJECTS_LABEL, entry: null }, ...projects];
}

function switcherEntryMatches(entry: AgentRailScopeEntry, needle: string): boolean {
  if (entry.label.toLocaleLowerCase().includes(needle)) return true;
  return entry.defaultLabel?.toLocaleLowerCase().includes(needle) === true;
}
