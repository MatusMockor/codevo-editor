import type { AgentProjectGroupingWriteRejection } from "../../application/agentProjectGroupingPreference";
import {
  remoteAgentProjectKey,
  remoteAgentProjectKeyParts,
  remoteAgentProjectServerId,
} from "../../application/remoteAgentProjection";
import type {
  RemoteProjectInventories,
  RemoteProjectInventory,
} from "../../application/useRemoteProjectInventories";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import {
  isAgentProjectGroupingMode,
  unsupportedAgentProjectGroupingMode,
  type AgentProjectGroupingMode,
  type AgentProjectGroupingSettings,
} from "../../domain/agentProjectGrouping";

export const MAX_PROJECT_GROUPING_ROWS = 64;
export const PROJECT_GROUPING_DEFAULT_VALUE = "";

const REMOTE_PREFIX = "remote:";

export interface ProjectGroupingServer {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
}

export type ProjectGroupingAvailability = "available" | "unavailable" | "unknown";
export type ProjectGroupingControl = "editable" | "followsConnection";

export interface ProjectGroupingRow {
  readonly rootKey: string;
  readonly label: string;
  readonly detail: string;
  readonly availability: ProjectGroupingAvailability;
  readonly control: ProjectGroupingControl;
  readonly override: AgentProjectGroupingMode | null;
}

export interface ProjectGroupingList {
  readonly rows: ReadonlyArray<ProjectGroupingRow>;
  readonly total: number;
  readonly unavailableRootKeys: ReadonlyArray<string>;
}

export interface ProjectGroupingListInput {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly servers: ReadonlyArray<ProjectGroupingServer>;
  readonly inventories: RemoteProjectInventories;
  readonly settings: AgentProjectGroupingSettings;
  readonly links: ReadonlyMap<string, string>;
  readonly displayNames: ReadonlyMap<string, string>;
}

export type ProjectGroupingSelection =
  | { readonly kind: "selected"; readonly mode: AgentProjectGroupingMode | null }
  | { readonly kind: "unsupported" };

type RowSeed = Omit<ProjectGroupingRow, "override">;

export function projectGroupingModeLabel(mode: AgentProjectGroupingMode): string {
  switch (mode) {
    case "repository":
      return "Group by repository";
    case "separate":
      return "Keep separate";
    default:
      return unsupportedAgentProjectGroupingMode(mode);
  }
}

export function projectGroupingSelection(value: string): ProjectGroupingSelection {
  if (value === PROJECT_GROUPING_DEFAULT_VALUE) return { kind: "selected", mode: null };
  if (!isAgentProjectGroupingMode(value)) return { kind: "unsupported" };
  return { kind: "selected", mode: value };
}

export function projectGroupingWriteMessage(reason: AgentProjectGroupingWriteRejection): string {
  switch (reason) {
    case "invalidMode":
    case "invalidProject":
      return "This grouping choice is not available. Your previous choice remains active.";
    case "tooManyOverrides":
      return "The override limit is reached. Set a listed project to Use default first.";
    case "storageCorrupt":
      return "Saved grouping settings could not be read. Reset grouping settings to make changes.";
    case "storageUnavailable":
      return "Could not save project grouping. Your previous choice remains active.";
    default:
      return unsupportedRejection(reason);
  }
}

export function projectGroupingList(input: ProjectGroupingListInput): ProjectGroupingList {
  const seeds = uniqueSeeds([
    ...localSeeds(input),
    ...input.servers.flatMap((server) => serverSeeds(server, input)),
    ...removedServerSeeds(input),
  ]);
  const rows = seeds.map((seed) => ({
    ...seed,
    override: input.settings.overrides.get(seed.rootKey) ?? null,
  }));
  return {
    rows: boundedRows(rows),
    total: rows.length,
    unavailableRootKeys: rows
      .filter((row) => row.availability === "unavailable" && row.override !== null)
      .map((row) => row.rootKey),
  };
}

function localSeeds(input: ProjectGroupingListInput): ReadonlyArray<RowSeed> {
  const open = input.projects
    .filter((project) => !project.rootKey.startsWith(REMOTE_PREFIX))
    .map((project) => seed(project.rootKey, localLabel(project, input), localDetail(project)));
  const closed = savedRootKeys(input)
    .filter((rootKey) => !rootKey.startsWith(REMOTE_PREFIX))
    .map((rootKey) =>
      seed(
        rootKey,
        input.displayNames.get(rootKey) ?? pathName(rootKey),
        `${rootKey}, not open`,
        "unavailable",
      ),
    );
  return [...open, ...closed];
}

function localDetail(project: AgentProjectDescriptor): string {
  if (project.origin === "closed-tab-live-tasks") return `${project.rootPath}, tab closed`;
  return project.rootPath;
}

function localLabel(project: AgentProjectDescriptor, input: ProjectGroupingListInput): string {
  return input.displayNames.get(project.rootKey) ?? project.label;
}

function serverSeeds(
  server: ProjectGroupingServer,
  input: ProjectGroupingListInput,
): ReadonlyArray<RowSeed> {
  const inventory = server.connected ? input.inventories.get(server.id) : undefined;
  const saved = savedRootKeys(input).filter(
    (rootKey) => remoteAgentProjectServerId(rootKey) === server.id,
  );
  if (inventory?.kind !== "ready") return savedServerSeeds(server, saved, input, inventory);
  const available = inventory.projects.map((project) => {
    const rootKey = remoteAgentProjectKey(server.id, inventory.runnerId, project.id);
    const follows = followedProject(rootKey, input);
    const label = input.displayNames.get(rootKey) ?? project.name;
    if (follows === null) return seed(rootKey, label, server.name);
    return seed(
      rootKey,
      label,
      `${server.name}, follows ${localLabel(follows, input)}`,
      "available",
      "followsConnection",
    );
  });
  return [...available, ...savedServerSeeds(server, saved, input, inventory)];
}

function savedServerSeeds(
  server: ProjectGroupingServer,
  saved: ReadonlyArray<string>,
  input: ProjectGroupingListInput,
  inventory: RemoteProjectInventory | undefined,
): ReadonlyArray<RowSeed> {
  const state = savedServerState(server, inventory);
  return saved.map((rootKey) =>
    seed(
      rootKey,
      input.displayNames.get(rootKey) ?? remoteProjectName(rootKey),
      `${server.name}, ${state.detail}`,
      state.availability,
    ),
  );
}

function savedServerState(
  server: ProjectGroupingServer,
  inventory: RemoteProjectInventory | undefined,
): { readonly detail: string; readonly availability: ProjectGroupingAvailability } {
  if (!server.connected) return { detail: "not connected", availability: "unknown" };
  if (inventory?.kind === "ready") return { detail: "not available", availability: "unavailable" };
  if (inventory?.kind === "loading" || inventory?.kind === "slow")
    return { detail: "loading", availability: "unknown" };
  return { detail: "not loaded", availability: "unknown" };
}

function removedServerSeeds(input: ProjectGroupingListInput): ReadonlyArray<RowSeed> {
  const serverIds = new Set(input.servers.map((server) => server.id));
  return savedRootKeys(input)
    .filter((rootKey) => rootKey.startsWith(REMOTE_PREFIX) && !ownedByServer(rootKey, serverIds))
    .map((rootKey) =>
      seed(
        rootKey,
        input.displayNames.get(rootKey) ?? remoteProjectName(rootKey),
        "server not found",
        "unavailable",
      ),
    );
}

function followedProject(
  rootKey: string,
  input: ProjectGroupingListInput,
): AgentProjectDescriptor | null {
  const localRoot = input.links.get(rootKey);
  if (localRoot === undefined || localRoot.startsWith(REMOTE_PREFIX)) return null;
  return input.projects.find((project) => project.rootKey === localRoot) ?? null;
}

function seed(
  rootKey: string,
  label: string,
  detail: string,
  availability: ProjectGroupingAvailability = "available",
  control: ProjectGroupingControl = "editable",
): RowSeed {
  return { rootKey, label, detail, availability, control };
}

function uniqueSeeds(seeds: ReadonlyArray<RowSeed>): ReadonlyArray<RowSeed> {
  const seen = new Set<string>();
  return seeds.filter((candidate) => {
    if (seen.has(candidate.rootKey)) return false;
    seen.add(candidate.rootKey);
    return true;
  });
}

function boundedRows(rows: ReadonlyArray<ProjectGroupingRow>): ReadonlyArray<ProjectGroupingRow> {
  if (rows.length <= MAX_PROJECT_GROUPING_ROWS) return rows;
  const kept = new Set(
    rows
      .map((row, index) => ({ index, rank: rowRank(row) }))
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .slice(0, MAX_PROJECT_GROUPING_ROWS)
      .map((entry) => entry.index),
  );
  return rows.filter((_, index) => kept.has(index));
}

function rowRank(row: ProjectGroupingRow): number {
  if (row.override === null) return 2;
  if (row.control === "followsConnection") return 1;
  return 0;
}

function savedRootKeys(input: ProjectGroupingListInput): ReadonlyArray<string> {
  return [...input.settings.overrides.keys()];
}

function ownedByServer(rootKey: string, serverIds: ReadonlySet<string>): boolean {
  const serverId = remoteAgentProjectServerId(rootKey);
  return serverId !== null && serverIds.has(serverId);
}

function pathName(rootKey: string): string {
  const parts = rootKey.split("/").filter((part) => part !== "");
  return parts[parts.length - 1] ?? rootKey;
}

function remoteProjectName(rootKey: string): string {
  const projectId = remoteAgentProjectKeyParts(rootKey)?.projectId ?? "";
  if (projectId === "") return rootKey;
  return projectId;
}

function unsupportedRejection(reason: never): never {
  throw new TypeError(`Unsupported project grouping rejection: ${String(reason)}.`);
}
