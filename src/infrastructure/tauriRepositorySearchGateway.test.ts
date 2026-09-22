import { expect, it } from "vitest";
import { TauriRepositoryLookupGateway } from "./tauriRepositoryLookupGateway";
it("validates before invoking native search", async () => {
  const calls: unknown[] = [];
  const gateway = new TauriRepositoryLookupGateway(async (...args) => {
    calls.push(args);
    return { status: "ok", repositories: [], nextPage: null, truncated: false };
  });
  await expect(
    gateway.search({ provider: "github", host: "github.com", query: "bad&value", page: 1 }),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
  await gateway.search({ provider: "github", host: "github.com", query: "crm", page: 1 });
  expect(calls).toEqual([
    [
      "repository_search",
      { request: { provider: "github", host: "github.com", query: "crm", page: 1 } },
    ],
  ]);
});
