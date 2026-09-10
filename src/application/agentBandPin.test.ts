import { describe, expect, it } from "vitest";
import { agentBandPin, type AgentBandPinFrame } from "./agentBandPin";

function frame(overrides: Partial<AgentBandPinFrame>): AgentBandPinFrame {
  return { intersecting: false, top: 0, rootTop: 0, rootHeight: 600, ...overrides };
}

describe("agent band pin", () => {
  it("releases the band while its turn sentinel is inside the scroll port", () => {
    expect(agentBandPin(frame({ intersecting: true, top: 40 }))).toBe("released");
    expect(agentBandPin(frame({ intersecting: true, top: 0 }))).toBe("released");
  });

  it("pins the band once its turn sentinel leaves through the top edge", () => {
    expect(agentBandPin(frame({ intersecting: false, top: -1 }))).toBe("pinned");
    expect(agentBandPin(frame({ intersecting: false, top: -900 }))).toBe("pinned");
    expect(agentBandPin(frame({ intersecting: false, top: 120, rootTop: 120 }))).toBe("pinned");
  });

  it("releases the band when the scroll port has no geometry at all", () => {
    expect(agentBandPin(frame({ intersecting: false, top: 0, rootTop: 0, rootHeight: 0 }))).toBe(
      "released",
    );
  });

  it("releases the band when its turn has not been reached yet", () => {
    expect(agentBandPin(frame({ intersecting: false, top: 900 }))).toBe("released");
    expect(agentBandPin(frame({ intersecting: false, top: 121, rootTop: 120 }))).toBe("released");
  });
});
