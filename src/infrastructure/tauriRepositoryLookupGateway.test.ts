import { describe, expect, it, vi } from "vitest";
import type { RepositoryLookupRequest } from "../domain/repositoryLookup";
import {
  TauriRepositoryLookupGateway,
  type InvokeRepositoryLookupCommand,
} from "./tauriRepositoryLookupGateway";

const request: RepositoryLookupRequest = {
  provider: "github",
  host: "github.com",
  path: "acme/storefront-api",
};

const repository = {
  provider: "github",
  host: "github.com",
  fullPath: "acme/storefront-api",
  description: "Storefront API service",
  visibility: "public",
  defaultBranch: "main",
  sshUrl: "git@github.com:acme/storefront-api.git",
  httpsUrl: "https://github.com/acme/storefront-api.git",
};

const snapshot = {
  github: {
    status: "ready",
    hosts: [{ provider: "github", host: "github.com", auth: "authenticated" }],
    truncated: false,
  },
  gitlab: { status: "cliMissing" },
};

describe("TauriRepositoryLookupGateway", () => {
  it("parses a host snapshot from the hosts command", async () => {
    const invokeCommand = vi.fn<InvokeRepositoryLookupCommand>().mockResolvedValue(snapshot);
    const gateway = new TauriRepositoryLookupGateway(invokeCommand);

    await expect(gateway.listHosts()).resolves.toEqual(snapshot);
    expect(invokeCommand.mock.calls).toEqual([["repository_lookup_hosts"]]);
  });

  it("forwards a validated request and parses the outcome", async () => {
    const invokeCommand = vi
      .fn<InvokeRepositoryLookupCommand>()
      .mockResolvedValue({ status: "ok", repository });
    const gateway = new TauriRepositoryLookupGateway(invokeCommand);

    await expect(gateway.lookup(request)).resolves.toEqual({ status: "ok", repository });
    expect(invokeCommand.mock.calls).toEqual([["repository_lookup", { request }]]);
  });

  it("parses every closed outcome shape", async () => {
    const outcomes = [
      { status: "notFound" },
      { status: "cliMissing" },
      { status: "notAuthenticated" },
      { status: "hostNotAllowed" },
      { status: "timedOut" },
      { status: "superseded" },
      { status: "rateLimited", retryAfterSeconds: 30 },
      { status: "rateLimited", retryAfterSeconds: null },
      { status: "failed", reason: "network" },
      { status: "failed", reason: "invalidOutput" },
      { status: "failed", reason: "outputTooLarge" },
      { status: "failed", reason: "busy" },
      { status: "failed", reason: "unknown" },
    ];
    const invokeCommand = vi.fn<InvokeRepositoryLookupCommand>();
    const gateway = new TauriRepositoryLookupGateway(invokeCommand);

    for (const outcome of outcomes) {
      invokeCommand.mockResolvedValueOnce(outcome);
      await expect(gateway.lookup(request)).resolves.toEqual(outcome);
    }
  });

  it("rejects an outbound request that is not normalized", async () => {
    const invokeCommand = vi.fn<InvokeRepositoryLookupCommand>();
    const gateway = new TauriRepositoryLookupGateway(invokeCommand);

    await expect(
      gateway.lookup({ provider: "github", host: "GitHub.com", path: "acme/storefront-api" }),
    ).rejects.toThrow(/lowercase hostname/u);
    await expect(
      gateway.lookup({ provider: "github", host: "github.com", path: "acme/storefront-api.git" }),
    ).rejects.toThrow(/normalized github repository path/u);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("fails closed on an unknown status, unknown field or oversized description", async () => {
    const invokeCommand = vi.fn<InvokeRepositoryLookupCommand>();
    const gateway = new TauriRepositoryLookupGateway(invokeCommand);

    invokeCommand.mockResolvedValueOnce({ status: "maybe" });
    await expect(gateway.lookup(request)).rejects.toThrow(/known repository lookup status/u);

    invokeCommand.mockResolvedValueOnce({ status: "notFound", detail: "gh said so" });
    await expect(gateway.lookup(request)).rejects.toThrow(/unexpected field/u);

    invokeCommand.mockResolvedValueOnce({
      status: "ok",
      repository: { ...repository, description: "x".repeat(201) },
    });
    await expect(gateway.lookup(request)).rejects.toThrow(/at most 200 characters/u);
  });

  it("fails closed on an invalid host snapshot", async () => {
    const invokeCommand = vi
      .fn<InvokeRepositoryLookupCommand>()
      .mockResolvedValueOnce({ github: { status: "ready", hosts: [], truncated: false } })
      .mockResolvedValueOnce({ ...snapshot, bitbucket: { status: "cliMissing" } });
    const gateway = new TauriRepositoryLookupGateway(invokeCommand);

    await expect(gateway.listHosts()).rejects.toThrow(/missing field/u);
    await expect(gateway.listHosts()).rejects.toThrow(/unexpected field/u);
  });

  it("propagates a transport failure without inventing an outcome", async () => {
    const invokeCommand = vi
      .fn<InvokeRepositoryLookupCommand>()
      .mockRejectedValue(new Error("ipc closed"));
    const gateway = new TauriRepositoryLookupGateway(invokeCommand);

    await expect(gateway.lookup(request)).rejects.toThrow("ipc closed");
    await expect(gateway.listHosts()).rejects.toThrow("ipc closed");
  });
});
