export type AgentActivityCategory =
  | { readonly kind: "command" }
  | { readonly kind: "edit" }
  | { readonly kind: "read" }
  | { readonly kind: "search" }
  | { readonly kind: "web" }
  | { readonly kind: "integration"; readonly server: string };

export interface AgentActivityToolCandidate {
  readonly kind: "tool";
  readonly stableId: string | null;
  readonly category: AgentActivityCategory;
  readonly running: boolean;
  readonly settledOk: boolean;
}

export type AgentActivityCandidate =
  { readonly kind: "boundary" } | { readonly kind: "thought" } | AgentActivityToolCandidate;

export interface AgentActivityCategoryCount {
  readonly category: AgentActivityCategory;
  readonly count: number;
}

export type AgentActivityFoldEntry =
  | { readonly kind: "item"; readonly index: number }
  | {
      readonly kind: "group";
      readonly stableId: string | null;
      readonly start: number;
      readonly end: number;
      readonly categories: ReadonlyArray<AgentActivityCategoryCount>;
      readonly running: number;
      readonly completed: number;
      readonly thoughts: number;
    };

export function agentActivityCategoryKey(category: AgentActivityCategory): string {
  switch (category.kind) {
    case "command":
      return "command";
    case "edit":
      return "edit";
    case "read":
      return "read";
    case "search":
      return "search";
    case "web":
      return "web";
    case "integration":
      return `mcp:${category.server}`;
    default:
      return unsupportedCategory(category);
  }
}

function unsupportedCategory(category: never): never {
  throw new TypeError(`Unsupported agent activity category: ${JSON.stringify(category)}`);
}

interface CategoryDraft {
  readonly category: AgentActivityCategory;
  count: number;
}

interface RunAccumulator {
  start: number;
  running: number;
  completed: number;
  thoughts: number;
  readonly counts: Map<string, CategoryDraft>;
}

export function foldAgentActivity(
  candidates: ReadonlyArray<AgentActivityCandidate>,
): ReadonlyArray<AgentActivityFoldEntry> {
  const entries: AgentActivityFoldEntry[] = [];
  const run: RunAccumulator = {
    start: -1,
    running: 0,
    completed: 0,
    thoughts: 0,
    counts: new Map(),
  };
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate.kind === "boundary") {
      closeRun(entries, candidates, run, index);
      entries.push({ kind: "item", index });
      continue;
    }
    if (run.start < 0) run.start = index;
    if (candidate.kind === "thought") {
      run.thoughts += 1;
      continue;
    }
    const key = agentActivityCategoryKey(candidate.category);
    const draft = run.counts.get(key) ?? { category: candidate.category, count: 0 };
    draft.count += 1;
    run.counts.set(key, draft);
    if (candidate.running) run.running += 1;
    if (candidate.settledOk) run.completed += 1;
  }
  closeRun(entries, candidates, run, candidates.length);
  return entries;
}

function closeRun(
  entries: AgentActivityFoldEntry[],
  candidates: ReadonlyArray<AgentActivityCandidate>,
  run: RunAccumulator,
  end: number,
): void {
  if (run.start < 0) return;
  entries.push(
    end - run.start === 1 && run.thoughts === 0
      ? { kind: "item", index: run.start }
      : {
          kind: "group",
          stableId: candidateStableId(candidates[run.start]),
          start: run.start,
          end,
          categories: [...run.counts.values()].map(({ category, count }) => ({ category, count })),
          running: run.running,
          completed: run.completed,
          thoughts: run.thoughts,
        },
  );
  run.start = -1;
  run.running = 0;
  run.completed = 0;
  run.thoughts = 0;
  run.counts.clear();
}

function candidateStableId(candidate: AgentActivityCandidate): string | null {
  if (candidate.kind !== "tool") return null;
  return candidate.stableId;
}
