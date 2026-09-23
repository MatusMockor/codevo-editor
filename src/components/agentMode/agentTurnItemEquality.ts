import type { AgentTurnItem } from "./agentTurnProjection";

const MAX_COMPARED_DEPTH = 6;

export function sameAgentTurnItem(left: AgentTurnItem, right: AgentTurnItem): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  const leftRecord = left as unknown as Readonly<Record<string, unknown>>;
  const rightRecord = right as unknown as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => sameValue(leftRecord[key], rightRecord[key], MAX_COMPARED_DEPTH));
}

export function agentTurnItemsMissingFrom(
  candidates: ReadonlyArray<AgentTurnItem>,
  shown: ReadonlyArray<AgentTurnItem>,
): ReadonlyArray<AgentTurnItem> {
  const byKey = new Map(shown.map((item) => [item.key, item]));
  return candidates.filter((item) => {
    const visible = byKey.get(item.key);
    return visible === undefined || !sameAgentTurnItem(visible, item);
  });
}

function sameValue(left: unknown, right: unknown, depth: number): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object") return false;
  if (left === null || right === null || depth <= 0) return false;
  if (Array.isArray(left) || Array.isArray(right)) return sameArray(left, right, depth);
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => sameValue(leftRecord[key], rightRecord[key], depth - 1));
}

function sameArray(left: unknown, right: unknown, depth: number): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => sameValue(value, right[index], depth - 1));
}
