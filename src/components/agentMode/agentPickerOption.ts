import type { ReactNode } from "react";

export type AgentPickerTone = "plan" | "danger" | null;

export interface AgentPickerOption {
  readonly value: string;
  readonly label: string;
  readonly description: string | null;
  readonly tone: AgentPickerTone;
  readonly detail: ReactNode;
}

export function agentPickerOption(
  value: string,
  label: string,
  description: string | null = null,
  tone: AgentPickerTone = null,
  detail: ReactNode = null,
): AgentPickerOption {
  return { value, label, description, tone, detail };
}
