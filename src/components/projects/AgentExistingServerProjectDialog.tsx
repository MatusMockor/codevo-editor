import { FolderOpen } from "lucide-react";
import { useId, useMemo, useState, type RefObject } from "react";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSurface,
} from "../../ui/foundation/CommandList";
import { commandItemId } from "../../ui/foundation/commandItemId";
import { useCommandListNavigation } from "../../ui/foundation/useCommandListNavigation";
import "./projects.css";

export const MAX_EXISTING_SERVER_PROJECT_ROWS = 64;
export const MAX_EXISTING_SERVER_PROJECT_QUERY_CHARS = 120;

const PLACEHOLDER = "Filter server projects";
const NO_PROJECTS =
  "No projects available on this server. Check its connection, clone a repository or add an existing folder.";
const NO_MATCH = "No matching project on this server.";

type ExistingServerProject = Readonly<{ key: string; label: string }>;

export interface AgentExistingServerProjectDialogProps {
  readonly projects: readonly ExistingServerProject[];
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onSelect(key: string): void;
}

export function AgentExistingServerProjectDialog({
  projects,
  onClose,
  onSelect,
  returnFocusRef,
}: AgentExistingServerProjectDialogProps) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const matches = useMemo(() => matchingProjects(projects, query), [projects, query]);
  const visible = useMemo(() => matches.slice(0, MAX_EXISTING_SERVER_PROJECT_ROWS), [matches]);
  const hiddenCount = matches.length - visible.length;
  const navigation = useCommandListNavigation({
    keys: visible.map((project) => project.key),
    resetKey: query,
    homeEndEnabled: query === "",
    onExecute: (index) => {
      const project = visible[index];
      if (project === undefined) return;
      onSelect(project.key);
    },
  });
  return (
    <CommandSurface label="Open server project" onClose={onClose} returnFocusRef={returnFocusRef}>
      <CommandInput
        activeDescendantId={
          navigation.activeIndex < 0 ? null : commandItemId(listboxId, navigation.activeIndex)
        }
        expanded={visible.length > 0}
        label={PLACEHOLDER}
        lead="search"
        listboxId={listboxId}
        onChange={(value) => setQuery(value.slice(0, MAX_EXISTING_SERVER_PROJECT_QUERY_CHARS))}
        onKeyDown={(event) => {
          navigation.handleKeyDown(event);
        }}
        placeholder={PLACEHOLDER}
        value={query}
      />
      <CommandPanel>
        {visible.length === 0 ? (
          <CommandEmpty>{projects.length === 0 ? NO_PROJECTS : NO_MATCH}</CommandEmpty>
        ) : (
          <CommandList id={listboxId} label="Server projects">
            {visible.map((project, index) => (
              <CommandItem
                active={navigation.activeIndex === index}
                icon={<FolderOpen aria-hidden="true" size={16} />}
                id={commandItemId(listboxId, index)}
                key={project.key}
                onHover={() => navigation.setActiveIndex(index)}
                onSelect={() => onSelect(project.key)}
                title={project.label}
              />
            ))}
          </CommandList>
        )}
        {hiddenCount > 0 && (
          <p className="cv-projects-notice" role="status">
            {hiddenCount} more not shown, refine the filter
          </p>
        )}
      </CommandPanel>
      <CommandFooter>
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        <CommandFooterHint keys={["Enter"]} label="Open" />
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </CommandSurface>
  );
}

function matchingProjects(
  projects: readonly ExistingServerProject[],
  query: string,
): readonly ExistingServerProject[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return projects;
  return projects.filter((project) => project.label.toLowerCase().includes(needle));
}
