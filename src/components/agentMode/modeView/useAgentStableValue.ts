import { useRef } from "react";

const DEFAULT_STRUCTURAL_DEPTH = 2;

function plainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function agentStructurallyEqual(left: unknown, right: unknown, depth: number): boolean {
  if (Object.is(left, right)) return true;
  if (depth <= 0) return false;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((entry, index) => agentStructurallyEqual(entry, right[index], depth - 1))
    );
  }
  if (!plainObject(left) || !plainObject(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      agentStructurallyEqual(left[key], right[key], depth - 1),
  );
}

export function useAgentStableValue<T>(value: T, depth: number = DEFAULT_STRUCTURAL_DEPTH): T {
  const previousRef = useRef(value);
  if (agentStructurallyEqual(previousRef.current, value, depth)) return previousRef.current;
  previousRef.current = value;
  return value;
}
