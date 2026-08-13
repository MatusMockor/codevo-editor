import type { ResolvedGitRepository } from "./gitRepositoryMapping";
import { MAX_AGENT_TASK_PATH_BYTES, type AgentIsolationPolicy } from "./agentTask";

export type AgentProjectTrust = "trusted" | "untrusted" | "unknown";
export type AgentProjectOrigin = "active-tab" | "background-tab" | "closed-tab-live-tasks";

export interface AgentProjectDescriptor {
  readonly rootKey: string;
  readonly rootPath: string;
  readonly ownerId: string;
  readonly label: string;
  readonly generation: number;
  readonly trust: AgentProjectTrust;
  readonly origin: AgentProjectOrigin;
  readonly repositories: ReadonlyArray<ResolvedGitRepository>;
  readonly isolationPolicy: AgentIsolationPolicy;
  readonly leaseToken: number | null;
}

export interface AgentRootLeaseAcquireRequest {
  readonly rootPath: string;
}

export interface AgentRootLeaseReleaseRequest {
  readonly rootPath: string;
  readonly leaseToken: number;
}

export interface AgentRootLeaseReceipt {
  readonly leaseToken: number;
}

export interface AgentRootLeaseGateway {
  acquireAgentRootLease(request: AgentRootLeaseAcquireRequest): Promise<AgentRootLeaseReceipt>;
  releaseAgentRootLease(request: AgentRootLeaseReleaseRequest): Promise<void>;
}

export const MAX_AGENT_PROJECT_ROOTS = 8;

const FNV1A_64_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;
const FNV1A_64_MASK = 0xffffffffffffffffn;
const UTF8_ENCODER = new TextEncoder();

export function fnv1a64hex(value: string): string {
  let hash = FNV1A_64_OFFSET_BASIS;
  for (const byte of UTF8_ENCODER.encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV1A_64_PRIME) & FNV1A_64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function agentRootOwnerId(rootKey: string): string {
  return `agent-root:${fnv1a64hex(rootKey)}`;
}

export function validateAgentRootLeaseAcquireRequest(value: unknown): AgentRootLeaseAcquireRequest {
  const request = record(value, "request");
  exactKeys(request, ["rootPath"], "request");
  return { rootPath: agentRootPath(request.rootPath, "request.rootPath") };
}

export function validateAgentRootLeaseReleaseRequest(value: unknown): AgentRootLeaseReleaseRequest {
  const request = record(value, "request");
  exactKeys(request, ["rootPath", "leaseToken"], "request");
  return {
    rootPath: agentRootPath(request.rootPath, "request.rootPath"),
    leaseToken: unsignedSafeInteger(request.leaseToken, "request.leaseToken"),
  };
}

export function parseAgentRootLeaseReceipt(value: unknown): AgentRootLeaseReceipt {
  const result = record(value, "result");
  exactKeys(result, ["leaseToken"], "result");
  return { leaseToken: unsignedSafeInteger(result.leaseToken, "result.leaseToken") };
}

function agentRootPath(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_AGENT_TASK_PATH_BYTES);
  if (candidate.trim() === "") invalid(path, "a non-blank bounded path");
  return candidate;
}

function boundedText(value: unknown, path: string, maxBytes: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /\p{Cc}/u.test(value) ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(path, "a non-empty bounded UTF-8 string");
  }
  return value;
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid agent root lease value at ${path}: expected ${expectation}.`);
}
