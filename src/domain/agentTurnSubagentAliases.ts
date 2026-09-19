import type { AgentTurnSubagentIds } from "./agentTurnEventSupersession";

export interface AgentTurnSubagentAliasIndex {
  readonly tasksByTool: Map<string, Map<string, number>>;
  readonly toolsByTask: Map<string, Map<string, number>>;
}

export interface AgentTurnSubagentResolution {
  readonly ids: AgentTurnSubagentIds;
  readonly canonical: boolean;
}

const UNRESOLVED: AgentTurnSubagentResolution = { ids: {}, canonical: false };

export function createAgentTurnSubagentAliasIndex(): AgentTurnSubagentAliasIndex {
  return { tasksByTool: new Map(), toolsByTask: new Map() };
}

export function retainAgentTurnSubagentAlias(
  index: AgentTurnSubagentAliasIndex,
  alias: Required<AgentTurnSubagentIds>,
  delta: 1 | -1,
): void {
  countPartner(index.tasksByTool, alias.toolId, alias.taskId, delta);
  countPartner(index.toolsByTask, alias.taskId, alias.toolId, delta);
}

export function resolveAgentTurnSubagentIds(
  index: AgentTurnSubagentAliasIndex,
  ids: AgentTurnSubagentIds,
): AgentTurnSubagentResolution {
  const { toolId, taskId } = ids;
  if (toolId !== undefined && taskId !== undefined) return resolvePair(index, toolId, taskId);
  if (toolId !== undefined) return resolveTool(index, toolId);
  if (taskId !== undefined) return resolveTask(index, taskId);
  return UNRESOLVED;
}

function resolvePair(
  index: AgentTurnSubagentAliasIndex,
  toolId: string,
  taskId: string,
): AgentTurnSubagentResolution {
  const canonical =
    onlyPartner(index.tasksByTool.get(toolId), taskId) &&
    onlyPartner(index.toolsByTask.get(taskId), toolId);
  return { ids: { toolId, taskId }, canonical };
}

function resolveTool(
  index: AgentTurnSubagentAliasIndex,
  toolId: string,
): AgentTurnSubagentResolution {
  const tasks = index.tasksByTool.get(toolId);
  if (tasks === undefined || tasks.size === 0) return { ids: { toolId }, canonical: true };
  const taskId = solePartner(tasks);
  if (taskId === null || !onlyPartner(index.toolsByTask.get(taskId), toolId))
    return { ids: { toolId }, canonical: false };
  return { ids: { toolId, taskId }, canonical: true };
}

function resolveTask(
  index: AgentTurnSubagentAliasIndex,
  taskId: string,
): AgentTurnSubagentResolution {
  const tools = index.toolsByTask.get(taskId);
  if (tools === undefined || tools.size === 0) return { ids: { taskId }, canonical: true };
  const toolId = solePartner(tools);
  if (toolId === null || !onlyPartner(index.tasksByTool.get(toolId), taskId))
    return { ids: { taskId }, canonical: false };
  return { ids: { toolId, taskId }, canonical: true };
}

function onlyPartner(partners: Map<string, number> | undefined, expected: string): boolean {
  if (partners === undefined || partners.size === 0) return true;
  return partners.size === 1 && partners.has(expected);
}

function solePartner(partners: Map<string, number>): string | null {
  if (partners.size !== 1) return null;
  const first = partners.keys().next();
  return first.done === true ? null : first.value;
}

function countPartner(
  links: Map<string, Map<string, number>>,
  id: string,
  partner: string,
  delta: 1 | -1,
): void {
  const partners = links.get(id) ?? new Map<string, number>();
  const count = (partners.get(partner) ?? 0) + delta;
  links.set(id, partners);
  if (count > 0) {
    partners.set(partner, count);
    return;
  }
  partners.delete(partner);
  if (partners.size === 0) links.delete(id);
}
