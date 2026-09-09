import { describe, expect, it, vi } from "vitest";
import type { AgentProviderUpdateCheckResult } from "../domain/agentProviderHealth";
import { createAgentProviderUpdateChecks } from "./agentProviderUpdateChecks";

function deferred() {
  let resolve!: (value: AgentProviderUpdateCheckResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<AgentProviderUpdateCheckResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  let generation = 0;
  let enabled = true;
  const calls: ReturnType<typeof deferred>[] = [];
  const publish = vi.fn();
  const reportError = vi.fn();
  const gateway = {
    probeAgentProviderHealth: vi.fn(),
    checkAgentProviderUpdates: vi.fn(() => {
      const call = deferred();
      calls.push(call);
      return call.promise;
    }),
  };
  const checks = createAgentProviderUpdateChecks({
    capture: () => {
      if (!enabled) return null;
      const captured = generation;
      return {
        request: { provider: "claudeCode", providerGeneration: captured },
        installedVersion: "1.0.0",
        gateway,
        current: () => captured === generation,
        publish,
        reportError,
      };
    },
  });
  return {
    calls,
    publish,
    reportError,
    gateway,
    checks,
    replace: () => {
      generation += 1;
    },
    disable: () => {
      enabled = false;
    },
  };
}
const current: AgentProviderUpdateCheckResult = {
  update: { kind: "current", installedVersion: "1.0.0" },
  checkedAtEpochMs: 1,
};
describe("lightweight provider update checks", () => {
  it("coalesces per provider and rejects late results after owner or diagnostic generation changes", async () => {
    const f = fixture();
    const stale = f.checks.check("claudeCode");
    expect(f.checks.check("claudeCode")).toBe(stale);
    f.replace();
    const fresh = f.checks.check("claudeCode");
    f.calls[0]!.resolve(current);
    await stale;
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.checks.check("claudeCode")).toBe(fresh);
    f.calls[1]!.resolve(current);
    await fresh;
    expect(f.publish).toHaveBeenCalledExactlyOnceWith(current.update);
    expect(f.gateway.probeAgentProviderHealth).not.toHaveBeenCalled();
  });
  it("rejects metadata for a different installed version", async () => {
    const f = fixture();
    const pending = f.checks.check("claudeCode");
    f.calls[0]!.resolve({ ...current, update: { kind: "current", installedVersion: "2.0.0" } });
    await pending;
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("does no work without known eligible health", async () => {
    const f = fixture();
    f.disable();
    await f.checks.checkAll(["claudeCode", "codex"]);
    expect(f.gateway.checkAgentProviderUpdates).not.toHaveBeenCalled();
  });
  it("keeps failures update-only, retries, and requires diagnostic authority for offers", async () => {
    const f = fixture();
    const pending = f.checks.check("claudeCode");
    f.calls[0]!.reject(new Error("Offline"));
    await pending;
    expect(f.publish).toHaveBeenCalledWith({ kind: "unavailable", reason: "probeFailed" });
    const retry = f.checks.check("claudeCode");
    f.calls[1]!.resolve(current);
    await retry;
    expect(f.checks.needsDiagnostics("claudeCode")).toBe(true);
    f.checks.confirmDiagnostics("claudeCode");
    expect(f.checks.needsDiagnostics("claudeCode")).toBe(false);
  });
  it("retries after a gateway throws before returning a promise", async () => {
    const f = fixture();
    f.gateway.checkAgentProviderUpdates.mockImplementationOnce(() => {
      throw new Error("Invalid request");
    });
    await f.checks.check("claudeCode");
    const retry = f.checks.check("claudeCode");
    expect(f.calls).toHaveLength(1);
    f.calls[0]!.resolve(current);
    await retry;
    expect(f.gateway.checkAgentProviderUpdates).toHaveBeenCalledTimes(2);
  });
  it("does not publish or report failures from an abandoned owner", async () => {
    const f = fixture();
    const pending = f.checks.check("claudeCode");
    f.replace();
    f.calls[0]!.reject(new Error("Late"));
    await pending;
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.reportError).not.toHaveBeenCalled();
  });
});
