import { describe, expect, it, vi } from "vitest";
import type { FileSearchGateway } from "../../../domain/workspace";
import { createAgentWorkbenchPorts } from "../../../agentWorkbenchPortsComposition";
import { UNAVAILABLE_AGENT_FILE_SEARCH } from "./agentRightPanelGateways";

describe("composed agent right panel gateways", () => {
  it("searches files only through the injected gateway", () => {
    const fileSearch: FileSearchGateway = { searchFiles: vi.fn(async () => []) };

    expect(createAgentWorkbenchPorts().rightPanelGateways(fileSearch).fileSearch).toBe(fileSearch);
  });

  it("rejects file search when no gateway was injected", async () => {
    await expect(UNAVAILABLE_AGENT_FILE_SEARCH.searchFiles("/repo", "a", 10)).rejects.toThrow(
      "File search is unavailable.",
    );
  });
});
