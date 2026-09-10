export type AgentBandPin = "pinned" | "released";

export interface AgentBandPinFrame {
  readonly intersecting: boolean;
  readonly top: number;
  readonly rootTop: number;
  readonly rootHeight: number;
}

export interface AgentBandPinObserver {
  observe(sentinel: Element, onChange: (pin: AgentBandPin) => void): () => void;
  dispose(): void;
}

export function agentBandPin(frame: AgentBandPinFrame): AgentBandPin {
  if (frame.rootHeight <= 0) return "released";
  if (frame.intersecting) return "released";
  if (frame.top > frame.rootTop) return "released";

  return "pinned";
}
