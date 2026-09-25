export type AgentBranchRef = `refs/heads/${string}` | `refs/remotes/${string}`;

export type AgentWorktreeBase =
  { readonly kind: "head" } | { readonly kind: "ref"; readonly ref: AgentBranchRef };

export const HEAD_WORKTREE_BASE: AgentWorktreeBase = { kind: "head" };
export const MAX_AGENT_BRANCH_REF_BYTES = 256;

const LOCAL_PREFIX = "refs/heads/";
const REMOTE_PREFIX = "refs/remotes/";
const FORBIDDEN_CHARACTERS = new Set(["~", "^", ":", "?", "*", "[", "\\"]);

export function parseAgentBranchRef(value: unknown): AgentBranchRef | null {
  if (typeof value !== "string") return null;
  if (new TextEncoder().encode(value).length > MAX_AGENT_BRANCH_REF_BYTES) return null;
  const prefix = refPrefix(value);
  if (prefix === null) return null;
  if (!validRefName(value.slice(prefix.length))) return null;
  return value as AgentBranchRef;
}

export function parseAgentWorktreeBase(value: unknown): AgentWorktreeBase | null {
  if (typeof value !== "object" || value === null) return null;
  const keys = Object.keys(value).sort().join(",");
  const record = value as { readonly kind?: unknown; readonly ref?: unknown };
  if (record.kind === "head" && keys === "kind") return HEAD_WORKTREE_BASE;
  if (record.kind !== "ref" || keys !== "kind,ref") return null;
  const ref = parseAgentBranchRef(record.ref);
  if (ref === null) return null;
  return { kind: "ref", ref };
}

export function localBranchRef(name: string): AgentBranchRef | null {
  return parseAgentBranchRef(`${LOCAL_PREFIX}${name}`);
}

export function remoteBranchRef(remote: string, name: string): AgentBranchRef | null {
  return parseAgentBranchRef(`${REMOTE_PREFIX}${remote}/${name}`);
}

export function agentBranchRefLabel(ref: AgentBranchRef): string {
  if (ref.startsWith(LOCAL_PREFIX)) return ref.slice(LOCAL_PREFIX.length);
  return ref.slice(REMOTE_PREFIX.length);
}

function refPrefix(value: string): string | null {
  if (value.startsWith(LOCAL_PREFIX)) return LOCAL_PREFIX;
  if (value.startsWith(REMOTE_PREFIX)) return REMOTE_PREFIX;
  return null;
}

function validRefName(name: string): boolean {
  if (name === "" || name === "@") return false;
  if (name.includes("..") || name.includes("@{")) return false;
  if (![...name].every(allowedCharacter)) return false;
  return name.split("/").every(validSegment);
}

function validSegment(segment: string): boolean {
  if (segment === "" || segment === "HEAD") return false;
  if (segment.startsWith(".") || segment.startsWith("-")) return false;
  return !segment.endsWith(".") && !segment.endsWith(".lock");
}

function allowedCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code <= 0x20) return false;
  if (code >= 0x7f && code <= 0x9f) return false;
  if (/\s/u.test(character)) return false;
  return !FORBIDDEN_CHARACTERS.has(character);
}
