import { AgentWorkingDuration } from "../agentClock";
import { agentTurnDurationLabel } from "../agentModePresentation";
import type { AgentTurnTiming } from "../agentTurnHeadPresentation";
import { agentClockTime } from "./agentTurnMetaLine";

export function AgentMetaTime({ epochMs }: { readonly epochMs: number | null }) {
  const time = agentClockTime(epochMs);
  if (time === null) return null;
  return (
    <time className="cv-turn-meta__time" dateTime={time.iso} title={time.title}>
      {time.label}
    </time>
  );
}

export interface AgentTurnMetaProps {
  readonly agentLabel: string;
  readonly atEpochMs: number | null;
  readonly timing: AgentTurnTiming;
}

export function AgentTurnMeta({ agentLabel, atEpochMs, timing }: AgentTurnMetaProps) {
  return (
    <div className="cv-turn-meta">
      <AgentMetaTime epochMs={atEpochMs} />
      <span className="cv-turn-meta__agent" title={agentLabel}>
        {agentLabel}
      </span>
      <AgentTurnMetaDuration timing={timing} />
    </div>
  );
}

function AgentTurnMetaDuration({ timing }: { readonly timing: AgentTurnTiming }) {
  if (timing.kind === "untimed") return null;
  if (timing.kind === "running") {
    return (
      <span className="cv-turn-meta__duration">
        <AgentWorkingDuration startedAtEpochMs={timing.startedAtEpochMs} />
      </span>
    );
  }
  return <span className="cv-turn-meta__duration">{agentTurnDurationLabel(timing.elapsedMs)}</span>;
}
