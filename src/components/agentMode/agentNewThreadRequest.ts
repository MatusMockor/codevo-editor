import { agentControlTooltip, agentShortcutGlyphs } from "./agentThreadHeaderPresentation";

export type AgentNewThreadRoute =
  { readonly kind: "create"; readonly projectRootKey: string } | { readonly kind: "picker" };

export interface AgentNewThreadRouteInput {
  readonly shiftKey: boolean;
  readonly activeProjectRootKey: string | null;
  readonly projectCount: number;
}

export interface AgentNewThreadTooltipInput {
  readonly shortcut: string;
  readonly pickerShortcut: string;
  readonly projectLabel: string | null;
  readonly projectCount: number;
}

const PICKER_ROUTE: AgentNewThreadRoute = Object.freeze({ kind: "picker" });

export function agentNewThreadRoute(input: AgentNewThreadRouteInput): AgentNewThreadRoute {
  if (input.activeProjectRootKey === null) return PICKER_ROUTE;
  if (input.shiftKey && input.projectCount > 1) return PICKER_ROUTE;
  return { kind: "create", projectRootKey: input.activeProjectRootKey };
}

export function agentNewThreadTooltip(input: AgentNewThreadTooltipInput): string {
  if (input.projectLabel === null) return agentControlTooltip("New thread", input.shortcut);
  const base = agentControlTooltip(`New thread in ${input.projectLabel}`, input.shortcut);
  const picker = agentShortcutGlyphs(input.pickerShortcut);
  if (input.projectCount <= 1 || picker === "") return base;
  return `${base} · ${picker}: choose project`;
}
