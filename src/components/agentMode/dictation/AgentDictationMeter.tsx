import type { SpeechDictationMeterStore } from "../../../application/speechDictationMeterStore";
import { useSpeechDictationMeter } from "../../../application/useSpeechDictation";
import { speechMeterFraction } from "../../../domain/speechPcm";
import { formatAgentDictationElapsed } from "./agentDictationPresentation";

export interface AgentDictationMeterProps {
  readonly meter: SpeechDictationMeterStore;
}

export function AgentDictationMeter({ meter }: AgentDictationMeterProps) {
  const { level, elapsedMs } = useSpeechDictationMeter(meter);
  const fraction = speechMeterFraction(level);
  return (
    <span className="agent-dictation__live" data-dictation-meter={fraction.toFixed(2)}>
      <span aria-hidden="true" className="agent-dictation__dot" />
      <span aria-hidden="true" className="agent-dictation__meter">
        <span
          className="agent-dictation__meter-fill"
          style={{ transform: `scaleX(${fraction.toFixed(3)})` }}
        />
      </span>
      <span className="agent-dictation__elapsed agent-num">
        {formatAgentDictationElapsed(elapsedMs)}
      </span>
    </span>
  );
}
