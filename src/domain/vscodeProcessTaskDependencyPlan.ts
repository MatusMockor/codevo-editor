import type { VscodeProcessTaskDisplay } from "./vscodeProcessTasks";

/**
 * Builds a deterministic dependencies-before-parent view of a backend-owned
 * sequence. The backend remains the sole process owner and executor; this
 * helper defensively rejects malformed display metadata at the IPC boundary.
 */
export function vscodeProcessTaskDependencyPlan(
  tasks: readonly VscodeProcessTaskDisplay[],
  rootLabel: string,
): readonly string[] | null {
  const byLabel = new Map<string, VscodeProcessTaskDisplay>();
  for (const task of tasks) {
    if (byLabel.has(task.label)) return null;
    byLabel.set(task.label, task);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const plan: string[] = [];
  const visit = (label: string): boolean => {
    if (visited.has(label)) return true;
    if (visiting.has(label)) return false;
    const task = byLabel.get(label);
    if (!task?.executable || new Set(task.dependsOn).size !== task.dependsOn.length) return false;
    visiting.add(label);
    for (const dependency of task.dependsOn) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(label);
    visited.add(label);
    plan.push(label);
    return true;
  };

  return visit(rootLabel) ? Object.freeze(plan) : null;
}
