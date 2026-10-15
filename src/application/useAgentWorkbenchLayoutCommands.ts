import {
  agentWorkbenchLayoutReducer,
  agentWorkbenchLayoutsEqual,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "../domain/agentWorkbenchLayout";
import {
  parseAgentFileRevealTarget,
  type AgentFileViewerReveal,
} from "../domain/agentWorkbenchLayoutFileReveal";
import {
  agentThreadSurfaceLayoutOf,
  findAgentThreadSurfaceLayout,
  rememberAgentThreadSurfaceLayout,
  withAgentThreadSurfaceLayout,
  type AgentThreadSurfaceLayouts,
} from "../domain/agentWorkbenchLayoutThreads";

export type AgentWorkbenchCommand = AgentWorkbenchLayoutAction;

export type AgentWorkbenchLayoutCommand = Exclude<
  AgentWorkbenchCommand,
  { readonly kind: "toggleRail" }
>;

type OwnedLayoutSource = "owner" | "hydration" | "dispatch";

export interface OwnedAgentWorkbenchLayout {
  readonly ownerKey: string | null;
  readonly generation: number;
  readonly hydrated: boolean;
  readonly layout: AgentWorkbenchLayout;
  readonly threadLayouts: AgentThreadSurfaceLayouts;
  readonly draftFileReveal: AgentFileViewerReveal | null;
  readonly persistedBottomPanel: boolean;
  readonly source: OwnedLayoutSource;
}

export function applyAgentWorkbenchCommand(
  current: OwnedAgentWorkbenchLayout,
  command: AgentWorkbenchLayoutCommand,
  threadId: string | null,
  revealSequence: number,
): OwnedAgentWorkbenchLayout {
  const entry = findAgentThreadSurfaceLayout(current.threadLayouts, threadId);
  const shown = withAgentThreadSurfaceLayout(current.layout, entry);
  const previousReveal = threadId === null ? current.draftFileReveal : (entry?.fileReveal ?? null);
  const step = nextStep(shown, command, previousReveal, revealSequence);
  if (step === null) return current;
  const unchanged =
    agentWorkbenchLayoutsEqual(shown, step.layout) && step.fileReveal === previousReveal;
  if (current.hydrated && unchanged) return current;
  const surfaces = agentThreadSurfaceLayoutOf(step.layout);
  return {
    ...current,
    hydrated: true,
    layout: step.layout,
    threadLayouts:
      threadId === null
        ? current.threadLayouts
        : rememberAgentThreadSurfaceLayout(
            current.threadLayouts,
            threadId,
            surfaces,
            step.fileReveal,
          ),
    draftFileReveal: threadId === null ? step.fileReveal : current.draftFileReveal,
    source: "dispatch",
  };
}

interface CommandStep {
  readonly layout: AgentWorkbenchLayout;
  readonly fileReveal: AgentFileViewerReveal | null;
}

function nextStep(
  shown: AgentWorkbenchLayout,
  command: AgentWorkbenchLayoutCommand,
  fileReveal: AgentFileViewerReveal | null,
  revealSequence: number,
): CommandStep | null {
  const layout = agentWorkbenchLayoutReducer(shown, command);
  if (command.kind !== "revealFile") return { layout, fileReveal };
  const target = parseAgentFileRevealTarget(command.path, command.line ?? null);
  if (target === null) return null;
  const reveal = { ...target, sequence: revealSequence };
  const request = command.request ?? null;
  return { layout, fileReveal: request === null ? reveal : { ...reveal, request } };
}
