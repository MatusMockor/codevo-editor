import { expect, it, vi } from "vitest";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import { createRemoteProjectRegistrationGateway } from "./remoteProjectRegistrationGateway";

const registered = {
  status: "registered" as const,
  project: { id: "billing", name: "billing" },
  created: true,
};

function runnerWith(registerProject: unknown): RemoteRunnerGateway {
  return { registerProject } as unknown as RemoteRunnerGateway;
}

it("is unavailable without a server or a runner that can register", () => {
  const registerProject = vi.fn();
  expect(createRemoteProjectRegistrationGateway(null, "server-a")).toBeNull();
  expect(createRemoteProjectRegistrationGateway(runnerWith(registerProject), null)).toBeNull();
  expect(createRemoteProjectRegistrationGateway(runnerWith(undefined), "server-a")).toBeNull();
  expect(registerProject).not.toHaveBeenCalled();
});

it("registers on the captured server only", async () => {
  const registerProject = vi.fn(async () => registered);
  const gateway = createRemoteProjectRegistrationGateway(runnerWith(registerProject), "server-a");
  expect(await gateway?.registerProject({ path: "/srv/repos/billing", name: "billing" })).toEqual(
    registered,
  );
  expect(registerProject).toHaveBeenCalledExactlyOnceWith({
    serverId: "server-a",
    path: "/srv/repos/billing",
    name: "billing",
  });
});

it.each([
  { path: "/", name: "billing" },
  { path: "/srv/repos/billing", name: "my.project" },
  { path: "srv/repos/billing", name: "billing" },
])("refuses the invalid input %j before reaching the runner", async (input) => {
  const registerProject = vi.fn(async () => registered);
  const gateway = createRemoteProjectRegistrationGateway(runnerWith(registerProject), "server-a");
  await expect(gateway?.registerProject(input)).rejects.toThrow("Invalid server project folder.");
  expect(registerProject).not.toHaveBeenCalled();
});

it.each([
  { status: "rejected", reason: "busy" },
  { ...registered, path: "/srv/repos/billing" },
  { ...registered, project: { id: "../billing", name: "billing" } },
  null,
])("refuses the malformed runner answer %j", async (answer) => {
  const gateway = createRemoteProjectRegistrationGateway(
    runnerWith(vi.fn(async () => answer)),
    "server-a",
  );
  await expect(
    gateway?.registerProject({ path: "/srv/repos/billing", name: "billing" }),
  ).rejects.toThrow("Invalid server project registration.");
});

it("lets a runner failure reach the caller", async () => {
  const gateway = createRemoteProjectRegistrationGateway(
    runnerWith(vi.fn(() => Promise.reject(new Error("Runner request failed (HTTP 404).")))),
    "server-a",
  );
  await expect(
    gateway?.registerProject({ path: "/srv/repos/billing", name: "billing" }),
  ).rejects.toThrow("Runner request failed (HTTP 404).");
});

it("identifies the runner of the captured server", async () => {
  const getRunner = vi.fn(async () => ({ runnerId: "runner-a" }));
  const gateway = createRemoteProjectRegistrationGateway(
    { getRunner, registerProject: vi.fn() } as unknown as RemoteRunnerGateway,
    "server-a",
  );
  expect(await gateway?.identifyRunner()).toBe("runner-a");
  expect(getRunner).toHaveBeenCalledExactlyOnceWith({ serverId: "server-a" });
});

it.each([null, {}, { runnerId: "" }, { runnerId: 7 }])(
  "refuses the runner descriptor %j",
  async (descriptor) => {
    const gateway = createRemoteProjectRegistrationGateway(
      {
        getRunner: vi.fn(async () => descriptor),
        registerProject: vi.fn(),
      } as unknown as RemoteRunnerGateway,
      "server-a",
    );
    await expect(gateway?.identifyRunner()).rejects.toThrow("Invalid server runner identity.");
  },
);
