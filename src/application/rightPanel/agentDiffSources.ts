import type { AgentTurnChangeSummary, AgentTurnFileDiff } from "../../domain/agentTurnChanges";
import type { GitChangeStatus, GitChangedFile, GitGateway } from "../../domain/git";

export const MAX_AGENT_DIFF_FILES = 500;

export interface AgentDiffFile {
  readonly repositoryRoot: string | null;
  readonly relativePath: string;
  readonly displayPath: string;
  readonly oldRelativePath: string | null;
  readonly status: GitChangeStatus;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface AgentDiffFileList {
  readonly files: ReadonlyArray<AgentDiffFile>;
  readonly truncated: boolean;
  readonly statsPartial: boolean;
  readonly unavailableReason: string | null;
}

export type AgentDiffSidesUnavailable = "binary" | "large" | "missing";

export interface AgentDiffSides {
  readonly original: string;
  readonly modified: string;
  readonly truncated: boolean;
  readonly unavailableReason: AgentDiffSidesUnavailable | null;
}

export interface AgentDiffSource {
  readonly key: string;
  readonly identity: string;
  listFiles(): Promise<AgentDiffFileList>;
  readSides(file: AgentDiffFile): Promise<AgentDiffSides>;
}

export interface AgentDiffLineStat {
  readonly relativePath: string;
  readonly added: number | null;
  readonly deleted: number | null;
}

export interface AgentDiffLineStats {
  readonly stats: ReadonlyArray<AgentDiffLineStat>;
  readonly truncated: boolean;
}

export interface AgentDiffLineStatsPort {
  lineStats(repositoryRoot: string, worktreePath: string | null): Promise<AgentDiffLineStats>;
}

export interface TurnDiffSourceInput {
  readonly threadId: string;
  readonly turnId: string;
  readonly repositoryRoot: string | null;
  readonly revision: number;
  getTurnChanges(threadId: string, turnId: string): Promise<AgentTurnChangeSummary>;
  getTurnFileDiff(
    threadId: string,
    turnId: string,
    relativePath: string,
  ): Promise<AgentTurnFileDiff>;
}

export interface WorkingTreeRepository {
  readonly root: string;
  readonly prefix: string;
}

export interface WorkingTreeDiffSourceInput {
  readonly repositories: ReadonlyArray<WorkingTreeRepository>;
  readonly worktreePath: string | null;
  readonly revision: string;
  readonly git: Pick<GitGateway, "getStatus" | "getDiff">;
  readonly lineStats: AgentDiffLineStatsPort | null;
}

export function agentDiffTruncationNote(shownFiles: number): string {
  if (shownFiles >= MAX_AGENT_DIFF_FILES)
    return `Showing the first ${MAX_AGENT_DIFF_FILES} changed files.`;
  return `Showing the first ${shownFiles} changed files. The full change list is too large to read.`;
}

const revisionKeys = new WeakMap<object, number>();
let nextRevisionKey = 1;

export function agentDiffRevisionKey(revision: object | undefined): number {
  if (revision === undefined) return 0;
  const known = revisionKeys.get(revision);
  if (known !== undefined) return known;
  const key = nextRevisionKey;
  nextRevisionKey += 1;
  revisionKeys.set(revision, key);
  return key;
}

export function turnDiffSource(input: TurnDiffSourceInput): AgentDiffSource {
  const identity = JSON.stringify(["turn", input.threadId, input.turnId, input.repositoryRoot]);
  return {
    key: JSON.stringify([identity, input.revision]),
    identity,
    async listFiles() {
      const summary = await input.getTurnChanges(input.threadId, input.turnId);
      const unavailableReason = turnUnavailableReason(summary);
      if (unavailableReason !== null) {
        return { files: [], truncated: false, statsPartial: false, unavailableReason };
      }
      return {
        files: summary.files.slice(0, MAX_AGENT_DIFF_FILES).map((file) => ({
          repositoryRoot: input.repositoryRoot,
          relativePath: file.relativePath,
          displayPath: file.relativePath,
          oldRelativePath: file.oldRelativePath,
          status: file.status,
          added: file.addedLines,
          deleted: file.deletedLines,
        })),
        truncated: summary.truncated || summary.files.length > MAX_AGENT_DIFF_FILES,
        statsPartial: false,
        unavailableReason: null,
      };
    },
    async readSides(file) {
      const diff = await input.getTurnFileDiff(input.threadId, input.turnId, file.relativePath);
      return {
        original: diff.original.text,
        modified: diff.modified.text,
        truncated: diff.original.truncated || diff.modified.truncated,
        unavailableReason: diff.unavailableReason,
      };
    },
  };
}

export function workingTreeDiffSource(input: WorkingTreeDiffSourceInput): AgentDiffSource {
  const changes = new Map<string, GitChangedFile>();
  const identity = JSON.stringify([
    "workingTree",
    input.repositories.map((repository) => repository.root),
    input.worktreePath,
  ]);
  return {
    key: JSON.stringify([identity, input.revision]),
    identity,
    async listFiles() {
      const lists = await Promise.all(
        input.repositories.map((repository) => listRepository(input, repository)),
      );
      changes.clear();
      const files: AgentDiffFile[] = [];
      let total = 0;
      let statsPartial = false;
      for (const list of lists) {
        total += list.entries.length;
        statsPartial = statsPartial || list.statsPartial;
        for (const entry of list.entries) {
          if (files.length >= MAX_AGENT_DIFF_FILES) break;
          changes.set(changeKey(entry.root, entry.file.relativePath), entry.change);
          files.push(entry.file);
        }
      }
      return {
        files,
        truncated: total > MAX_AGENT_DIFF_FILES,
        statsPartial,
        unavailableReason: null,
      };
    },
    async readSides(file) {
      const root = file.repositoryRoot;
      const known = root === null ? undefined : changes.get(changeKey(root, file.relativePath));
      if (root === null || known === undefined) {
        return { original: "", modified: "", truncated: false, unavailableReason: "missing" };
      }
      const diff = await input.git.getDiff(root, known);
      return {
        original: diff.originalContent,
        modified: diff.modifiedContent,
        truncated: false,
        unavailableReason: diff.previewUnavailableReason ?? null,
      };
    },
  };
}

interface RepositoryEntry {
  readonly root: string;
  readonly file: AgentDiffFile;
  readonly change: GitChangedFile;
}

interface RepositoryListing {
  readonly entries: ReadonlyArray<RepositoryEntry>;
  readonly statsPartial: boolean;
}

interface RepositoryLineStats {
  readonly byPath: ReadonlyMap<string, AgentDiffLineStat>;
  readonly partial: boolean;
}

async function listRepository(
  input: WorkingTreeDiffSourceInput,
  repository: WorkingTreeRepository,
): Promise<RepositoryListing> {
  const [status, stats] = await Promise.all([
    input.git.getStatus(repository.root),
    lineStatsFor(input, repository.root),
  ]);
  const entries = status.changes.map((change): RepositoryEntry => {
    const stat = stats.byPath.get(change.relativePath);
    return {
      root: repository.root,
      change,
      file: {
        repositoryRoot: repository.root,
        relativePath: change.relativePath,
        displayPath: `${repository.prefix}${change.relativePath}`,
        oldRelativePath: change.oldRelativePath,
        status: change.status,
        added: stat?.added ?? null,
        deleted: stat?.deleted ?? null,
      },
    };
  });
  const missingStats = entries.some((entry) => !stats.byPath.has(entry.change.relativePath));
  return { entries, statsPartial: stats.partial && missingStats };
}

async function lineStatsFor(
  input: WorkingTreeDiffSourceInput,
  root: string,
): Promise<RepositoryLineStats> {
  if (input.lineStats === null) return { byPath: new Map(), partial: true };
  try {
    const result = await input.lineStats.lineStats(root, input.worktreePath);
    return {
      byPath: new Map(result.stats.map((stat) => [stat.relativePath, stat])),
      partial: result.truncated,
    };
  } catch {
    return { byPath: new Map(), partial: true };
  }
}

function turnUnavailableReason(summary: AgentTurnChangeSummary): string | null {
  switch (summary.state) {
    case "ready":
      return null;
    case "unavailable":
      return summary.reason ?? "Changes for this turn are unavailable.";
    case "unsupported":
      return "Recorded changes are not available for this project.";
    default: {
      const unreachable: never = summary.state;
      return unreachable;
    }
  }
}

function changeKey(root: string, relativePath: string): string {
  return JSON.stringify([root, relativePath]);
}
