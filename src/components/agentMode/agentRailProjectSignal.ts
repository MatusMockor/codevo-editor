import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentPendingInteraction } from "../../domain/agentPendingInteraction";
import { agentRailOwnerIndex } from "./agentRailProjectLayout";
import { agentRailRowStatus } from "./agentRailWorkingSection";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import { agentRowStatusTone, type AgentRowStatusTone } from "./agentThreadRowStatus";

export type AgentRailProjectSignalTone = "attention" | "working" | "unread";

export interface AgentRailProjectSignal {
  readonly tone: AgentRailProjectSignalTone;
  readonly label: string;
}

interface AgentRailProjectSignalCounts {
  readonly waiting: number;
  readonly running: number;
  readonly unread: number;
}

const NO_SIGNAL_COUNTS: AgentRailProjectSignalCounts = Object.freeze({
  waiting: 0,
  running: 0,
  unread: 0,
});

export function agentRailProjectSignal(
  threads: ReadonlyArray<AgentThreadView>,
  pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
  working: number = 0,
): AgentRailProjectSignal | null {
  return signalForCounts({
    waiting: threads.filter((view) => pendingInteractions.has(view.thread.threadId)).length,
    running: threads.filter((view) => view.lifecycle === "running").length + working,
    unread: threads.filter((view) => view.unread).length,
  });
}

export function agentRailProjectSignals(
  views: ReadonlyArray<AgentThreadView>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
  now: number,
): ReadonlyMap<string, AgentRailProjectSignal> {
  const owners = agentRailOwnerIndex(entries);
  const counts = new Map<string, AgentRailProjectSignalCounts>();
  for (const view of views) {
    const owner = owners.get(view.thread.owner.rootKey);
    if (owner === undefined) continue;
    const tone = threadSignalTone(view, pendingInteractions, now);
    if (tone === null) continue;
    const key = owner.projectRootKey;
    counts.set(key, countedTone(counts.get(key) ?? NO_SIGNAL_COUNTS, tone));
  }
  const signals = new Map<string, AgentRailProjectSignal>();
  for (const [key, count] of counts) {
    const signal = signalForCounts(count);
    if (signal !== null) signals.set(key, signal);
  }
  return signals;
}

function signalForCounts(counts: AgentRailProjectSignalCounts): AgentRailProjectSignal | null {
  if (counts.waiting > 0)
    return { tone: "attention", label: `${countLabel(counts.waiting)} waiting for you` };
  if (counts.running > 0)
    return { tone: "working", label: `${countLabel(counts.running)} working` };
  if (counts.unread > 0) return { tone: "unread", label: `${countLabel(counts.unread)} unread` };
  return null;
}

function threadSignalTone(
  view: AgentThreadView,
  pendingInteractions: ReadonlyMap<string, AgentPendingInteraction>,
  now: number,
): AgentRailProjectSignalTone | null {
  if (view.thread.archived) return null;
  const live = liveSignalTone(agentRowStatusTone(agentRailRowStatus(view, pendingInteractions)));
  if (live !== null) return live;
  if (!view.unread) return null;
  if (threadIsShelved(view, now)) return null;
  return "unread";
}

function liveSignalTone(tone: AgentRowStatusTone): AgentRailProjectSignalTone | null {
  switch (tone) {
    case "warn":
      return "attention";
    case "work":
      return "working";
    case "ok":
    case "fail":
    case "quiet":
      return null;
    default:
      return unsupportedSignalInput(tone);
  }
}

function threadIsShelved(view: AgentThreadView, now: number): boolean {
  if (view.thread.settledAt != null) return true;
  return (view.thread.snoozedUntil ?? 0) > now;
}

function countedTone(
  counts: AgentRailProjectSignalCounts,
  tone: AgentRailProjectSignalTone,
): AgentRailProjectSignalCounts {
  switch (tone) {
    case "attention":
      return { ...counts, waiting: counts.waiting + 1 };
    case "working":
      return { ...counts, running: counts.running + 1 };
    case "unread":
      return { ...counts, unread: counts.unread + 1 };
    default:
      return unsupportedSignalInput(tone);
  }
}

function countLabel(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

function unsupportedSignalInput(value: never): never {
  throw new TypeError(`Unsupported agent rail project signal input: ${String(value)}.`);
}
