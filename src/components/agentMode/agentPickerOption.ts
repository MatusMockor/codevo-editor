import type { ReactNode } from "react";

export type AgentPickerTone = "plan" | "danger" | null;

export interface AgentPickerOption {
  readonly value: string;
  readonly label: string;
  readonly description: string | null;
  readonly tone: AgentPickerTone;
  readonly detail: ReactNode;
  readonly icon: ReactNode;
  readonly group: string | null;
  readonly selected: boolean;
}

export function agentPickerOption(
  value: string,
  label: string,
  description: string | null = null,
  tone: AgentPickerTone = null,
  detail: ReactNode = null,
  icon: ReactNode = null,
  group: string | null = null,
  selected = false,
): AgentPickerOption {
  return { value, label, description, tone, detail, icon, group, selected };
}

export function agentPickerGroupHeading(
  options: ReadonlyArray<AgentPickerOption>,
  index: number,
): string | null {
  const option = options[index];
  if (option === undefined || option.group === null) return null;
  const previous = index === 0 ? null : (options[index - 1] ?? null);
  if (previous !== null && previous.group === option.group) return null;
  return option.group;
}
