import { describe, expect, it, vi } from "vitest";
import { MAX_AGENT_PROJECT_ROOTS } from "../domain/agentProject";
import type {
  WorkspaceTrustGateway,
  WorkspaceOpenedProjectIdentity,
  WorkspaceTrustState,
} from "../domain/trust";
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

describe("deferred opened project trust", () => {
  it("observes a deferred admission without granting and leaves later admissions to the durable store", async () => {
    const store = new FakeTrustStore();
    store.revoke("/project");
    const admission = new AgentOpenedProjectAdmission();
    const port = store.gateway();
    admission.deferTrust("/project/");
    await expect(admission.authorize(identity(1), untrusted, port, () => true)).resolves.toBeNull();
    await expect(admission.authorize(identity(1), untrusted, port, () => true)).resolves.toBeNull();
    expect(port.grantOpenedProject).not.toHaveBeenCalled();
    await expect(admission.authorize(identity(2), untrusted, port, () => true)).resolves.toBeNull();
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
    expect(store.isTrusted("/project")).toBe(false);
  });

  it("consumes the deferral even when the admission is already trusted", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    admission.deferTrust("/project");
    await admission.authorize(identity(1), { ...untrusted, trusted: true }, port, () => true);
    await admission.authorize(identity(2), untrusted, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
  });

  it("cancels exactly its own deferral", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    const cancelFirst = admission.deferTrust("/project");
    cancelFirst();
    await admission.authorize(identity(1), untrusted, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
    const cancelStale = admission.deferTrust("/other");
    admission.deferTrust("/other/");
    cancelStale();
    await admission.authorize(identity(2, "/other"), untrusted, port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
  });

  it("bounds deferred roots and drops the oldest first", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    for (let index = 0; index < 17; index += 1) admission.deferTrust(`/p${index}`);
    await admission.authorize(
      identity(1, "/p0"),
      { rootPath: "/p0", trusted: false },
      port,
      () => true,
    );
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
    await admission.authorize(
      identity(2, "/p16"),
      { rootPath: "/p16", trusted: false },
      port,
      () => true,
    );
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
  });
});

describe("durably revoked opened project trust", () => {
  it("keeps a revoked clone untrusted across relaunch, close/reopen and A->B->A until the dialog grants", async () => {
    const store = new FakeTrustStore();
    store.revoke("/clone");
    const port = store.gateway();
    const first = new AgentOpenedProjectAdmission();
    await expect(
      first.authorize(identity(1, "/clone"), store.stateFor("/clone"), port, () => true),
    ).resolves.toBeNull();

    const relaunched = new AgentOpenedProjectAdmission();
    await expect(
      relaunched.authorize(identity(2, "/clone"), store.stateFor("/clone"), port, () => true),
    ).resolves.toBeNull();

    relaunched.retain([]);
    await expect(
      relaunched.authorize(identity(3, "/clone"), store.stateFor("/clone"), port, () => true),
    ).resolves.toBeNull();

    await expect(
      relaunched.authorize(identity(4, "/other"), store.stateFor("/other"), port, () => true),
    ).resolves.toEqual({ rootPath: "/other", trusted: true });
    await expect(
      relaunched.authorize(identity(5, "/clone"), store.stateFor("/clone"), port, () => true),
    ).resolves.toBeNull();
    expect(store.isTrusted("/clone")).toBe(false);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(5);

    await port.setTrust("/clone", true);
    expect(store.isTrusted("/clone")).toBe(true);
    const afterGrant = new AgentOpenedProjectAdmission();
    await expect(
      afterGrant.authorize(identity(6, "/clone"), store.stateFor("/clone"), port, () => true),
    ).resolves.toBeNull();
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(5);
  });

  it("does not retry a refused admission for the same token", async () => {
    const store = new FakeTrustStore();
    store.revoke("/clone");
    const port = store.gateway();
    const admission = new AgentOpenedProjectAdmission();
    await admission.authorize(identity(1, "/clone"), store.stateFor("/clone"), port, () => true);
    await admission.authorize(identity(1, "/clone"), store.stateFor("/clone"), port, () => true);
    expect(port.grantOpenedProject).toHaveBeenCalledTimes(1);
  });

  it("still surfaces unrelated grant failures", async () => {
    const admission = new AgentOpenedProjectAdmission();
    const port = gateway();
    port.grantOpenedProject.mockRejectedValueOnce("trust lock failed");
    await expect(admission.authorize(identity(), untrusted, port, () => true)).rejects.toBe(
      "trust lock failed",
    );
  });
});

class FakeTrustStore {
  private readonly trusted = new Set<string>();
  private readonly revoked = new Set<string>();

  revoke(root: string): void {
    this.trusted.delete(root);
    this.revoked.add(root);
  }

  isTrusted(root: string): boolean {
    return this.trusted.has(root);
  }

  stateFor(root: string): WorkspaceTrustState {
    return { rootPath: root, trusted: this.trusted.has(root) };
  }

  gateway() {
    const grantOpenedProject = vi.fn(async (descriptor: WorkspaceOpenedProjectIdentity) => {
      const root = descriptor.canonicalRoot;
      if (this.revoked.has(root)) return Promise.reject("workspace trust was revoked");
      this.trusted.add(root);
      return { rootPath: root, trusted: true };
    });
    const getTrust = vi.fn(async (root: string) => this.stateFor(root));
    const setTrust = vi.fn(async (root: string, trusted: boolean) => {
      if (trusted) {
        this.revoked.delete(root);
        this.trusted.add(root);
      }
      if (!trusted) this.revoke(root);
      return this.stateFor(root);
    });
    return { getTrust, setTrust, grantOpenedProject };
  }
}
