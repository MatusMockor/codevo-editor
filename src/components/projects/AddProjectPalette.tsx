import { FolderOpen, FolderPlus, History, Link2 } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { RepositoryHostStatuses } from "../../application/useRepositoryHostStatus";
import type { RecentFolderEntry } from "../../domain/recentFolders";
import type { RemoteRunnerServer } from "../../domain/remoteRunner";
import {
  CommandEmpty,
  CommandFooter,
  CommandFooterHint,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSurface,
} from "../../ui/foundation/CommandList";
import { commandItemId } from "../../ui/foundation/commandItemId";
import { useCommandListNavigation } from "../../ui/foundation/useCommandListNavigation";
import { RemoteAddProjectSourceGlyph } from "../agentMode/remoteAddProject/RemoteAddProjectSources";
import {
  addProjectPaletteGroups,
  pastedCloneUrl,
  type AddProjectPaletteItem,
  type AddProjectSourceId,
} from "./addProjectPaletteModel";
import { EnvironmentControl } from "./EnvironmentControl";
import "./projects.css";

export interface AddProjectPaletteProps {
  readonly servers: readonly RemoteRunnerServer[];
  readonly serverId: string | null;
  readonly hosts: RepositoryHostStatuses;
  readonly recent: readonly RecentFolderEntry[];
  readonly home: string | null;
  readonly cloneAvailable: boolean;
  readonly notice: string | null;
  onServerChange(serverId: string | null): void;
  onClose(): void;
  onOpenFolder(): void;
  onOpenPath(path: string): void;
  onCloneForm(url: string): void;
  onRepositoryPicker(provider: "github" | "gitlab"): void;
  onServerAction(serverId: string, action: "existing" | "clone"): void;
}

const PLACEHOLDER = "Search sources, or paste a path or Git URL";

export function AddProjectPalette(props: AddProjectPaletteProps) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [nowMs] = useState(() => Date.now());
  const previousLength = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const environmentRef = useRef<HTMLButtonElement | null>(null);
  const environment = props.serverId === null ? "local" : "remote";
  const groups = useMemo(
    () =>
      addProjectPaletteGroups({
        query,
        environment,
        hosts: props.hosts,
        recent: props.recent,
        home: props.home,
        nowMs,
        cloneAvailable: props.cloneAvailable,
      }),
    [environment, nowMs, props.cloneAvailable, props.home, props.hosts, props.recent, query],
  );
  const items = groups.flatMap((group) => group.items);
  const select = (item: AddProjectPaletteItem | undefined) => {
    if (item === undefined) return;
    switch (item.kind) {
      case "recent":
      case "openPath":
        props.onOpenPath(item.path);
        return;
      case "cloneUrl":
        props.onCloneForm(item.url);
        return;
      case "refusedPath":
        return;
      case "source":
        if (item.disabledReason !== null) return;
        runSource(item.id, props);
        return;
      default:
        unsupportedItem(item);
    }
  };
  const navigation = useCommandListNavigation({
    keys: items.map((item) => item.key),
    resetKey: `${environment}:${props.serverId ?? ""}:${query}`,
    homeEndEnabled: query === "",
    onExecute: (index) => select(items[index]),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (openFolderShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      if (props.serverId === null) props.onOpenFolder();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      environmentRef.current?.focus();
      return;
    }
    navigation.handleKeyDown(event);
  };
  const onEnvironmentKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    inputRef.current?.focus();
  };
  const onChange = (value: string) => {
    const jumped = value.length - previousLength.current > 1;
    previousLength.current = value.length;
    setQuery(value);
    if (!jumped) return;
    const url = pastedCloneUrl({
      query: value,
      environment,
      home: props.home,
      cloneAvailable: props.cloneAvailable,
    });
    if (url !== null) props.onCloneForm(url);
  };
  let index = -1;
  return (
    <CommandSurface label="Add project" onClose={props.onClose}>
      <CommandInput
        activeDescendantId={
          navigation.activeIndex < 0 ? null : commandItemId(listboxId, navigation.activeIndex)
        }
        expanded={items.length > 0}
        inputRef={inputRef}
        label={PLACEHOLDER}
        lead="search"
        leadIcon={<FolderPlus aria-hidden="true" size={16} />}
        listboxId={listboxId}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={PLACEHOLDER}
        trailing={
          <EnvironmentControl
            onChange={props.onServerChange}
            onTriggerKeyDown={onEnvironmentKeyDown}
            serverId={props.serverId}
            servers={props.servers}
            triggerRef={environmentRef}
          />
        }
        value={query}
      />
      <CommandPanel>
        {items.length === 0 ? (
          <CommandEmpty>No matching sources.</CommandEmpty>
        ) : (
          <CommandList id={listboxId} label="Sources">
            {groups.map((group) => (
              <CommandGroup key={group.label} label={group.label}>
                {group.items.map((item) => {
                  index += 1;
                  const position = index;
                  return (
                    <CommandItem
                      active={navigation.activeIndex === position}
                      description={item.description}
                      disabled={itemDisabled(item)}
                      hint={item.kind === "source" ? (item.disabledReason ?? undefined) : undefined}
                      icon={<ItemIcon item={item} />}
                      id={commandItemId(listboxId, position)}
                      key={item.key}
                      onHover={() => navigation.setActiveIndex(position)}
                      onSelect={() => select(item)}
                      shortcut={item.kind === "source" ? (item.shortcut ?? undefined) : undefined}
                      timestamp={item.kind === "recent" ? (item.age ?? undefined) : undefined}
                      title={item.title}
                      trailing={itemTrailing(item)}
                    />
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
        )}
        {props.notice === null ? null : (
          <p className="cv-projects-notice" role="status">
            {props.notice}
          </p>
        )}
      </CommandPanel>
      <CommandFooter>
        <CommandFooterHint keys={["↑", "↓"]} label="Navigate" />
        <CommandFooterHint keys={["Enter"]} label="Select" />
        <CommandFooterHint keys={["Esc"]} label="Close" />
      </CommandFooter>
    </CommandSurface>
  );
}

function openFolderShortcut(event: KeyboardEvent<HTMLElement>): boolean {
  return (
    event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "o"
  );
}

function runSource(id: AddProjectSourceId, props: AddProjectPaletteProps): void {
  switch (id) {
    case "folder":
      props.onOpenFolder();
      return;
    case "gitUrl":
      props.onCloneForm("");
      return;
    case "github":
      if (props.hosts.github.kind === "ready") {
        props.onRepositoryPicker("github");
        return;
      }
      props.onCloneForm("");
      return;
    case "gitlab":
      props.onRepositoryPicker("gitlab");
      return;
    case "serverProject":
      if (props.serverId !== null) props.onServerAction(props.serverId, "existing");
      return;
    case "serverClone":
      if (props.serverId !== null) props.onServerAction(props.serverId, "clone");
      return;
    default:
      unsupportedSource(id);
  }
}

function ItemIcon({ item }: { readonly item: AddProjectPaletteItem }) {
  if (item.kind === "recent") return <History aria-hidden="true" size={16} />;
  if (item.kind === "openPath" || item.kind === "refusedPath")
    return <FolderOpen aria-hidden="true" size={16} />;
  if (item.kind === "cloneUrl") return <Link2 aria-hidden="true" size={16} />;
  if (item.id === "github" || item.id === "gitlab")
    return <RemoteAddProjectSourceGlyph kind={item.id} />;
  if (item.id === "gitUrl" || item.id === "serverClone")
    return <RemoteAddProjectSourceGlyph kind="gitUrl" />;
  return <FolderOpen aria-hidden="true" size={16} />;
}

function itemDisabled(item: AddProjectPaletteItem): boolean {
  if (item.kind === "refusedPath") return true;
  return item.kind === "source" && item.disabledReason !== null;
}

function itemTrailing(item: AddProjectPaletteItem) {
  if (item.kind !== "source" || item.chip === null) return undefined;
  return (
    <span className="cv-projects-chip" data-tone={item.chip.tone}>
      {item.chip.label}
    </span>
  );
}

function unsupportedSource(id: never): never {
  throw new TypeError(`Unsupported add project source: ${String(id)}.`);
}

function unsupportedItem(item: never): never {
  throw new TypeError(`Unsupported add project item: ${JSON.stringify(item)}.`);
}
