import { describe, expect, it, vi } from "vitest";
import { RemoteRunnerRequestRejectedError } from "../domain/remoteRunnerErrors";
import { validateRemoteRunnerValue } from "../domain/remoteRunnerValidation";
import { REMOTE_RUNNER_COMMANDS, TauriRemoteRunnerGateway } from "./tauriRemoteRunnerGateway";

const request = { serverId: "linux", path: "/srv/repos/billing", name: "billing" };
const registered = {
  status: "registered",
  project: { id: "billing", name: "billing" },
  created: true,
};

describe("remote project registration boundary", () => {
  it("declares the registration command", () => {
    expect(REMOTE_RUNNER_COMMANDS.registerProject).toBe("remote_runner_register_project");
  });

  it.each([
    registered,
    { ...registered, created: false },
    { status: "rejected", reason: "not_git_root" },
    { status: "rejected", reason: "name_taken" },
    { status: "rejected", reason: "limit_reached" },
    { status: "rejected", reason: "not_allowed" },
  ])("sends the exact request and returns %j", async (response) => {
    const invoke = vi.fn().mockResolvedValue(response);
    expect(await new TauriRemoteRunnerGateway(invoke).registerProject(request)).toEqual(response);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("remote_runner_register_project", { request });
  });

  it.each([
    { ...request, name: "my.project" },
    { ...request, name: "-billing" },
    { ...request, name: "" },
    { ...request, name: "b".repeat(65) },
    { ...request, path: "/" },
    { ...request, path: "srv/repos/billing" },
    { ...request, path: "/srv/repos/billing/" },
    { ...request, path: "/srv/../etc" },
    { ...request, path: `/${"p".repeat(4096)}` },
    { ...request, branch: "main" },
    { ...request, serverId: "" },
    { serverId: "linux", path: "/srv/repos/billing" },
    { serverId: "linux", name: "billing" },
  ])("rejects the malformed request %j before IPC", async (malformed) => {
    const invoke = vi.fn();
    const gateway = new TauriRemoteRunnerGateway(invoke);
    await expect(
      gateway.registerProject(malformed as Parameters<typeof gateway.registerProject>[0]),
    ).rejects.toBeInstanceOf(RemoteRunnerRequestRejectedError);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { status: "rejected", reason: "busy" },
    { status: "rejected" },
    { status: "rejected", reason: "name_taken", name: "billing" },
    { status: "registered", project: { id: "billing", name: "billing" } },
    { ...registered, path: "/srv/repos/billing" },
    { ...registered, project: { id: "billing", name: "billing", runnerId: "runner" } },
    { ...registered, project: { id: "bill ing", name: "billing" } },
    { ...registered, project: { id: "billing", name: "" } },
    { ...registered, created: 1 },
  ])("rejects the malformed response %j", async (response) => {
    const invoke = vi.fn().mockResolvedValue(response);
    await expect(new TauriRemoteRunnerGateway(invoke).registerProject(request)).rejects.toThrow(
      "Invalid remote runner registerProject response.",
    );
    expect(() => validateRemoteRunnerValue("registerProject", "response", response)).toThrow();
  });

  it("keeps the HTTP status of a runner that predates the route", async () => {
    const invoke = vi.fn().mockRejectedValue("Runner request failed (HTTP 404).");
    const outcome = new TauriRemoteRunnerGateway(invoke).registerProject(request);
    await expect(outcome).rejects.toBeInstanceOf(RemoteRunnerRequestRejectedError);
    await expect(outcome).rejects.toThrow("Runner request failed (HTTP 404).");
  });

  it("passes a busy runner failure through unchanged", async () => {
    const invoke = vi.fn().mockRejectedValue("Runner request failed (HTTP 503).");
    await expect(new TauriRemoteRunnerGateway(invoke).registerProject(request)).rejects.toBe(
      "Runner request failed (HTTP 503).",
    );
  });
});
