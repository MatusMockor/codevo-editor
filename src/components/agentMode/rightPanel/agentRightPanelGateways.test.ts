import { describe, expect, it, vi } from "vitest";
import type { FileSearchGateway } from "../../../domain/workspace";
import {
  UNAVAILABLE_AGENT_FILE_SEARCH,
  createDefaultAgentRightPanelGateways,
} from "./agentRightPanelGateways";

describe("createDefaultAgentRightPanelGateways", () => {
  it("searches files only through the injected gateway", () => {
    const fileSearch: FileSearchGateway = { searchFiles: vi.fn(async () => []) };

    expect(createDefaultAgentRightPanelGateways(fileSearch).fileSearch).toBe(fileSearch);
  });

  it("rejects file search when no gateway was injected", async () => {
    await expect(UNAVAILABLE_AGENT_FILE_SEARCH.searchFiles("/repo", "a", 10)).rejects.toThrow(
      "File search is unavailable.",
    );
  });
});
