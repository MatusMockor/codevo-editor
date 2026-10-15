import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workbench controller agent composition", () => {
  it("threads the single CLI discovery port through the focused agent coordinator", () => {
    const composition = source("../agentAppComposition.ts");
    const coordinator = source("./useWorkbenchControllerAgents.ts");

    expect(composition).toContain("agentCliDiscoveryGateway: new TauriAgentCliDiscoveryGateway(),");
    expect(composition).not.toContain("agentCliVersionGateway");
    expect(coordinator).toContain(
      'readonly agentCliDiscoveryGateway?: WorkbenchAgentsOptions["agentCliDiscoveryGateway"];',
    );
    expect(coordinator).toContain("agentCliDiscoveryGateway:");
    expect(coordinator).not.toContain("agentCliVersionGateway");
  });
});

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}
