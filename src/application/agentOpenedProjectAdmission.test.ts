import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_PROJECT_ROOTS } from "../domain/agentProject";
import type { WorkspaceTrustGateway, WorkspaceOpenedProjectIdentity } from "../domain/trust";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import { AgentOpenedProjectAdmission } from "./agentOpenedProjectAdmission";

function identity(admissionToken = 1, root = "/project"): WorkspaceIdentityDescriptor {
  return {
    admissionToken,
    workspaceId: `workspace-${admissionToken}`,
    selectedPath: root,
    canonicalRoot: root,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved",
    policy: { caseSensitive: true, unicodeNormalization: "none" },
  };
}

function gateway() {
  const grantOpenedProject = vi.fn(async (descriptor: WorkspaceOpenedProjectIdentity) => ({
    rootPath: descriptor.canonicalRoot,
    trusted: true,
  }));
  return { getTrust: vi.fn(), setTrust: vi.fn(), grantOpenedProject };
}

const untrusted = { rootPath: "/project", trusted: false };

describe("opened agent project admission", () => {
  it("marks an already trusted admission observed and never regrants its revocation", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    await admission.authorize(identity(), { ...untrusted, trusted: true }, port, () => true);
    await admission.authorize(identity(), untrusted, port, () => true);
    expect(port.grantOpenedProject).not.toHaveBeenCalled();
    await admission.authorize(identity(2), untrusted, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
  });

  it("rejects missing admission tokens and absent grant capabilities without path fallback", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    await admission.authorize(
      { ...identity(), admissionToken: undefined },
      untrusted,
      port,
      () => true,
    );
    const legacy: WorkspaceTrustGateway = { getTrust: port.getTrust, setTrust: port.setTrust };
    await admission.authorize(identity(), untrusted, legacy, () => true);
    expect(port.grantOpenedProject).not.toHaveBeenCalled();
    expect(port.setTrust).not.toHaveBeenCalled();
  });

  it("rejects stale completions and malformed grant roots", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    let current = true;
    port.grantOpenedProject.mockImplementationOnce(async () => {
      current = false;
      return { rootPath: "/project", trusted: true };
    });
    expect(await admission.authorize(identity(), untrusted, port, () => current)).toBeNull();
    port.grantOpenedProject.mockResolvedValueOnce({ rootPath: "/foreign", trusted: true });
    await expect(admission.authorize(identity(2), untrusted, port, () => true)).rejects.toThrow(
      "mismatched",
    );
  });

  it("bounds retained admissions and releases closed roots", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    for (let index = 0; index < MAX_AGENT_PROJECT_ROOTS + 1; index += 1) {
      const descriptor = identity(index + 1, `/project-${index}`);
      await admission.authorize(descriptor, untrusted, port, () => true);
    }
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(MAX_AGENT_PROJECT_ROOTS);
    admission.retain([]);
    await admission.authorize(identity(99), untrusted, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(MAX_AGENT_PROJECT_ROOTS + 1);
  });
});
