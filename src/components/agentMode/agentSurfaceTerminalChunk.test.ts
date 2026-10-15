import { describe, expect, it, vi } from "vitest";
import { preloadAgentSurfaceTerminal } from "./agentSurfaceTerminalChunk";

const loadTerminalTabsPanel = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("../terminalTabsPanelChunk", () => ({ loadTerminalTabsPanel }));
vi.mock("./AgentSurfaceTerminal", () => ({ AgentSurfaceTerminal: () => null }));

describe("agentSurfaceTerminalChunk", () => {
  it("requests the terminal tabs chunk together with the surface chunk", () => {
    preloadAgentSurfaceTerminal();
    preloadAgentSurfaceTerminal();

    expect(loadTerminalTabsPanel).toHaveBeenCalledTimes(1);
  });
});
