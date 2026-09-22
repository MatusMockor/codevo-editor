import { describe, expect, it } from "vitest";
import { parseRepositorySearchQuery } from "./repositoryLookup";
import {
  parseRepositorySearchOutcome,
  validateRepositorySearchRequest,
} from "./repositoryLookupValidation";

describe("repository search boundary", () => {
  it.each(["crm", "acme/crm", "my crm", "a.b-c_d"])(
    "accepts a bounded name or path: %s",
    (query) => {
      expect(
        validateRepositorySearchRequest({ provider: "github", host: "github.com", query, page: 1 })
          .query,
      ).toBe(query);
    },
  );
  it.each(["", "-flag", "a..b", "repo\n", "a&token=x", "user:me", "a".repeat(101), "é"])(
    "rejects unsafe query %s",
    (query) => {
      expect(() =>
        validateRepositorySearchRequest({ provider: "github", host: "github.com", query, page: 1 }),
      ).toThrow();
    },
  );
  it("normalizes UI input separately from strict IPC", () =>
    expect(parseRepositorySearchQuery(" crm ")).toBe("crm"));
  it.each([0, 11, 1.5, NaN])("bounds page %s", (page) =>
    expect(() =>
      validateRepositorySearchRequest({
        provider: "github",
        host: "github.com",
        query: "crm",
        page,
      }),
    ).toThrow(),
  );
  it("keeps empty results and provider truncation explicit", () => {
    expect(
      parseRepositorySearchOutcome({
        status: "ok",
        repositories: [],
        nextPage: 2,
        truncated: true,
      }),
    ).toEqual({ status: "ok", repositories: [], nextPage: 2, truncated: true });
    expect(() =>
      parseRepositorySearchOutcome({
        status: "ok",
        repositories: [],
        nextPage: 1,
        truncated: false,
      }),
    ).toThrow();
    expect(() =>
      parseRepositorySearchOutcome({
        status: "ok",
        repositories: [],
        nextPage: null,
        truncated: false,
        token: "secret",
      }),
    ).toThrow();
    expect(() =>
      parseRepositorySearchOutcome({
        status: "ok",
        repositories: Array(21).fill({}),
        nextPage: null,
        truncated: false,
      }),
    ).toThrow();
  });
});
