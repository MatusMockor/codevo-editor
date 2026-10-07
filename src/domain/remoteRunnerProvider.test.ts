import { describe, expect, it } from "vitest";
import commandCatalogContract from "../../contracts/agent-command-catalog-wire.json";
import mcpServersContract from "../../contracts/agent-mcp-servers-wire.json";
import type { AgentCliKind } from "./agentTask";
import { agentCliKindOfRemoteRunnerProvider, remoteRunnerProviderOf } from "./remoteRunnerProvider";

const KINDS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];

describe("remote runner provider names", () => {
  it("maps each local provider to the name the runner contract declares", () => {
    const mapping = Object.fromEntries(KINDS.map((kind) => [kind, remoteRunnerProviderOf(kind)]));
    expect(mapping).toEqual(mcpServersContract.remoteRunnerProviders);
    expect(commandCatalogContract.remoteRequests.map(({ value }) => value.provider)).toEqual(
      KINDS.map(remoteRunnerProviderOf),
    );
  });

  it("maps a runner provider name back to exactly the local provider it came from", () => {
    for (const kind of KINDS) {
      expect(agentCliKindOfRemoteRunnerProvider(remoteRunnerProviderOf(kind))).toBe(kind);
    }
    expect(agentCliKindOfRemoteRunnerProvider("claude")).toBe("claudeCode");
    expect(agentCliKindOfRemoteRunnerProvider("codex")).toBe("codex");
  });
});
