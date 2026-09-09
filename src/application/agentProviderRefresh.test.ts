import { describe, expect, it, vi } from "vitest";
import type { AgentCliKind } from "../domain/agentTask";
import type { AgentCliDiscoveryPublication } from "./useAgentCliDiscovery";
import { refreshAgentProviderBatch } from "./agentProviderRefresh";
import type { AgentProviderRefreshOutcome } from "./useAgentProviderManagement";

function fixture() {
  let release: (publication: AgentCliDiscoveryPublication | null) => void = () => undefined;
  const pending = new Promise<AgentCliDiscoveryPublication | null>((resolve) => {
    release = resolve;
  });
  const revisions = { claudeCode: 1, codex: 1 };
  const dependencies = {
    providers: ["claudeCode", "codex"] as const,
    refreshDiscovery: vi.fn(() => pending),
    discoveryGeneration: () => 1,
    configurationRevision: (provider: AgentCliKind) => revisions[provider],
    applyDiscovery: vi.fn(),
    isCurrent: vi.fn(() => true),
    refreshHealth: vi.fn(async (provider: AgentCliKind): Promise<AgentProviderRefreshOutcome> => ({
      kind: "complete",
      authority: { provider, revision: 1, providerGeneration: 1, disposition: { kind: "ready" } },
    })),
  };
  return { dependencies, revisions, release };
}
const PUBLICATION: AgentCliDiscoveryPublication = {
  generation: 1,
  result: { claudeCode: { kind: "notFound" }, codex: { kind: "notFound" } },
};

describe("provider refresh batch ownership", () => {
  it("retires only the provider whose configuration changed during discovery", async () => {
    const { dependencies, revisions, release } = fixture();
    const pending = refreshAgentProviderBatch(dependencies);
    revisions.claudeCode += 1;
    release(PUBLICATION);
    expect((await pending).map((outcome) => outcome.kind)).toEqual(["stale", "complete"]);
    expect(dependencies.refreshHealth).toHaveBeenCalledExactlyOnceWith("codex", 1);
    expect(dependencies.refreshDiscovery).toHaveBeenCalledOnce();
  });

  it("does not apply discovery or start health checks after the exact owner retires", async () => {
    const { dependencies, release } = fixture();
    const pending = refreshAgentProviderBatch(dependencies);
    dependencies.isCurrent.mockReturnValue(false);
    release(PUBLICATION);
    expect((await pending).map((outcome) => outcome.kind)).toEqual(["stale", "stale"]);
    expect(dependencies.applyDiscovery).toHaveBeenCalledExactlyOnceWith("discovering", 1);
    expect(dependencies.refreshHealth).not.toHaveBeenCalled();
  });
});
