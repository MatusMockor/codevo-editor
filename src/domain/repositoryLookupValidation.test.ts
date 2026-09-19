import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/repository-lookup-wire.json";
import {
  parseRepositoryHostsSnapshot,
  parseRepositoryLookupOutcome,
  validateRepositoryLookupRequest,
  REPOSITORY_RETRY_AFTER_SECONDS_MAX,
} from "./repositoryLookupValidation";
import { REPOSITORY_LOOKUP_LIMITS, type RepositoryLookupRequest } from "./repositoryLookup";

type WireFixture = Readonly<{ name: string; value: unknown }>;

const requests: readonly WireFixture[] = wireContract.requests;
const rejectedRequests: readonly WireFixture[] = wireContract.rejectedRequests;
const hostsSnapshots: readonly WireFixture[] = wireContract.hostsSnapshots;
const rejectedHostsSnapshots: readonly WireFixture[] = wireContract.rejectedHostsSnapshots;
const outcomes: readonly WireFixture[] = wireContract.outcomes;
const rejectedOutcomes: readonly WireFixture[] = wireContract.rejectedOutcomes;

const asRequest = (value: unknown) => value as RepositoryLookupRequest;
const statusOf = (fixture: WireFixture) => (fixture.value as { status: string }).status;
const okRepository = () => {
  const fixture = outcomes.find((item) => item.name === "okGithubPublic");
  expect(fixture).toBeDefined();
  return structuredClone(fixture?.value) as { status: string; repository: Record<string, unknown> };
};

describe("repository lookup wire contract", () => {
  it("covers every outcome status and failure reason", () => {
    expect(new Set(outcomes.map(statusOf))).toEqual(
      new Set([
        "ok",
        "notFound",
        "cliMissing",
        "notAuthenticated",
        "hostNotAllowed",
        "timedOut",
        "superseded",
        "rateLimited",
        "failed",
      ]),
    );
    const failures = outcomes
      .filter((fixture) => statusOf(fixture) === "failed")
      .map((fixture) => (fixture.value as { reason: string }).reason);
    expect(new Set(failures)).toEqual(
      new Set(["network", "invalidOutput", "outputTooLarge", "busy", "unknown"]),
    );
  });

  it("covers every repository visibility and hosts state", () => {
    const visibilities = outcomes
      .filter((fixture) => statusOf(fixture) === "ok")
      .map(
        (fixture) =>
          (fixture.value as { repository: { visibility: string } }).repository.visibility,
      );
    expect(new Set(visibilities)).toEqual(new Set(["public", "private", "internal", "unknown"]));
    const states = hostsSnapshots.flatMap((fixture) =>
      Object.values(fixture.value as Record<string, { status: string }>).map(
        (state) => state.status,
      ),
    );
    expect(new Set(states)).toEqual(new Set(["ready", "cliMissing", "failed"]));
  });

  it("uses unique fixture names", () => {
    const names = [
      ...requests,
      ...rejectedRequests,
      ...hostsSnapshots,
      ...rejectedHostsSnapshots,
      ...outcomes,
      ...rejectedOutcomes,
    ].map((fixture) => fixture.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("validateRepositoryLookupRequest", () => {
  it.each(requests)("accepts request $name", ({ value }) => {
    expect(validateRepositoryLookupRequest(asRequest(value))).toEqual(value);
  });

  it.each(rejectedRequests)("rejects request $name", ({ value }) => {
    expect(() => validateRepositoryLookupRequest(asRequest(value))).toThrow(TypeError);
  });

  it("returns a frozen request", () => {
    const request = validateRepositoryLookupRequest({
      provider: "github",
      host: "github.com",
      path: "acme/storefront-api",
    });
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("reports a bounded message that does not echo the value", () => {
    const path = `acme/${"long-".repeat(200)}`;
    try {
      validateRepositoryLookupRequest(asRequest({ provider: "github", host: "github.com", path }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message.length).toBeLessThanOrEqual(256);
      expect((error as TypeError).message).not.toContain("long-long-");
    }
  });
});

describe("parseRepositoryHostsSnapshot", () => {
  it.each(hostsSnapshots)("accepts snapshot $name", ({ value }) => {
    expect(parseRepositoryHostsSnapshot(value)).toEqual(value);
  });

  it.each(rejectedHostsSnapshots)("rejects snapshot $name", ({ value }) => {
    expect(() => parseRepositoryHostsSnapshot(value)).toThrow(TypeError);
  });

  it("accepts exactly the host limit and rejects one more", () => {
    const hosts = Array.from({ length: REPOSITORY_LOOKUP_LIMITS.hostsPerProvider }, (_, index) => ({
      provider: "gitlab" as const,
      host: `gitlab-${index}.example.com`,
      auth: "authenticated" as const,
    }));
    const snapshot = (items: readonly unknown[]) => ({
      github: { status: "cliMissing" },
      gitlab: { status: "ready", hosts: items, truncated: false },
    });
    expect(parseRepositoryHostsSnapshot(snapshot(hosts))).toEqual(snapshot(hosts));
    expect(() =>
      parseRepositoryHostsSnapshot(
        snapshot([
          ...hosts,
          { provider: "gitlab", host: "gitlab-8.example.com", auth: "authenticated" },
        ]),
      ),
    ).toThrow(TypeError);
  });

  it("rejects non object snapshots", () => {
    expect(() => parseRepositoryHostsSnapshot(null)).toThrow(TypeError);
    expect(() => parseRepositoryHostsSnapshot([])).toThrow(TypeError);
    expect(() => parseRepositoryHostsSnapshot("ready")).toThrow(TypeError);
  });

  it("freezes the parsed snapshot", () => {
    const snapshot = parseRepositoryHostsSnapshot({
      github: { status: "cliMissing" },
      gitlab: { status: "ready", hosts: [], truncated: false },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.github)).toBe(true);
  });
});

describe("parseRepositoryLookupOutcome", () => {
  it.each(outcomes)("accepts outcome $name", ({ value }) => {
    expect(parseRepositoryLookupOutcome(value)).toEqual(value);
  });

  it.each(rejectedOutcomes)("rejects outcome $name", ({ value }) => {
    expect(() => parseRepositoryLookupOutcome(value)).toThrow(TypeError);
  });

  it("bounds the rate limit retry hint", () => {
    expect(
      parseRepositoryLookupOutcome({
        status: "rateLimited",
        retryAfterSeconds: REPOSITORY_RETRY_AFTER_SECONDS_MAX,
      }),
    ).toEqual({ status: "rateLimited", retryAfterSeconds: REPOSITORY_RETRY_AFTER_SECONDS_MAX });
    expect(() =>
      parseRepositoryLookupOutcome({
        status: "rateLimited",
        retryAfterSeconds: REPOSITORY_RETRY_AFTER_SECONDS_MAX + 1,
      }),
    ).toThrow(TypeError);
    expect(() =>
      parseRepositoryLookupOutcome({ status: "rateLimited", retryAfterSeconds: "60" }),
    ).toThrow(TypeError);
  });

  it("bounds the repository description", () => {
    const repository = okRepository();
    repository.repository.description = "d".repeat(REPOSITORY_LOOKUP_LIMITS.descriptionChars);
    expect(parseRepositoryLookupOutcome(repository)).toEqual(repository);
    repository.repository.description = "d".repeat(REPOSITORY_LOOKUP_LIMITS.descriptionChars + 1);
    expect(() => parseRepositoryLookupOutcome(repository)).toThrow(TypeError);
  });

  it("keeps a clone url whose host differs from the api host", () => {
    const repository = okRepository();
    repository.repository.sshUrl = "ssh://git@altssh.github.com:443/acme/storefront-api.git";
    expect(parseRepositoryLookupOutcome(repository)).toEqual(repository);
  });

  it("rejects a repository whose provider is unknown", () => {
    const repository = okRepository();
    repository.repository.provider = "bitbucket";
    expect(() => parseRepositoryLookupOutcome(repository)).toThrow(TypeError);
  });

  it("freezes the parsed outcome", () => {
    const outcome = parseRepositoryLookupOutcome(okRepository());
    expect(Object.isFrozen(outcome)).toBe(true);
  });
});
