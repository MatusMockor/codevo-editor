const VISIBLE_DEPENDENCY_LIMIT = 3;

export function vscodeProcessTaskDependencySummary(dependencies: readonly string[]): string | null {
  if (dependencies.length === 0) return null;
  const visible = dependencies.slice(0, VISIBLE_DEPENDENCY_LIMIT).join(", ");
  const remaining = dependencies.length - VISIBLE_DEPENDENCY_LIMIT;
  return remaining > 0 ? `Runs after: ${visible} (+${remaining} more)` : `Runs after: ${visible}`;
}
