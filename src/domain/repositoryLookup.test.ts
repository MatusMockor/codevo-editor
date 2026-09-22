import { describe, expect, it } from "vitest";
import {
  isRepositoryHost,
  isRepositoryProvider,
  parseRepositoryPath,
  REPOSITORY_LOOKUP_LIMITS,
  REPOSITORY_PATH_SEGMENT_LIMITS,
  REPOSITORY_PROVIDERS,
  type RepositoryProvider,
} from "./repositoryLookup";

type PathCase = Readonly<{
  name: string;
  provider: RepositoryProvider;
  raw: string;
  expected: string | null;
}>;

const longSegment = "a".repeat(REPOSITORY_LOOKUP_LIMITS.pathChars - "acme/".length);
const overlongSegment = `${longSegment}a`;
const deepGitlabPath = (segments: number) =>
  Array.from({ length: segments }, (_, index) => `group${index}`).join("/");

const pathCases: readonly PathCase[] = [
  {
    name: "github owner/repo",
    provider: "github",
    raw: "acme/storefront-api",
    expected: "acme/storefront-api",
  },
  {
    name: "github strips a trailing .git",
    provider: "github",
    raw: "acme/storefront-api.git",
    expected: "acme/storefront-api",
  },
  {
    name: "github trims surrounding whitespace",
    provider: "github",
    raw: "  acme/storefront-api\t",
    expected: "acme/storefront-api",
  },
  {
    name: "github trims a trailing newline",
    provider: "github",
    raw: "acme/storefront-api\n",
    expected: "acme/storefront-api",
  },
  {
    name: "github keeps dots and underscores inside a segment",
    provider: "github",
    raw: "acme/store.front_api",
    expected: "acme/store.front_api",
  },
  {
    name: "github at the path character limit",
    provider: "github",
    raw: `acme/${longSegment}`,
    expected: `acme/${longSegment}`,
  },
  {
    name: "github over the path character limit",
    provider: "github",
    raw: `acme/${overlongSegment}`,
    expected: null,
  },
  { name: "github with one segment", provider: "github", raw: "acme", expected: null },
  {
    name: "github with three segments",
    provider: "github",
    raw: "acme/team/storefront-api",
    expected: null,
  },
  {
    name: "github leading dash",
    provider: "github",
    raw: "-acme/storefront-api",
    expected: null,
  },
  {
    name: "github segment starting with a dot",
    provider: "github",
    raw: "acme/.storefront-api",
    expected: null,
  },
  { name: "github placeholder segment", provider: "github", raw: "acme/:id", expected: null },
  { name: "github ampersand", provider: "github", raw: "acme/store&front", expected: null },
  {
    name: "github fragment character",
    provider: "github",
    raw: "acme/store#front",
    expected: null,
  },
  { name: "github percent escape", provider: "github", raw: "acme/store%2Ffront", expected: null },
  { name: "github embedded newline", provider: "github", raw: "acme/store\nfront", expected: null },
  { name: "github embedded NUL", provider: "github", raw: "acme/store\u0000front", expected: null },
  { name: "github parent segment", provider: "github", raw: "acme/../storefront", expected: null },
  {
    name: "github double dot inside",
    provider: "github",
    raw: "acme/store..front",
    expected: null,
  },
  { name: "github empty segment", provider: "github", raw: "acme//storefront", expected: null },
  { name: "github trailing slash", provider: "github", raw: "acme/storefront/", expected: null },
  { name: "github empty input", provider: "github", raw: "   ", expected: null },
  { name: "github only .git", provider: "github", raw: ".git", expected: null },
  {
    name: "gitlab group/project",
    provider: "gitlab",
    raw: "platform/billing-service",
    expected: "platform/billing-service",
  },
  {
    name: "gitlab nested groups",
    provider: "gitlab",
    raw: "platform/payments/billing-service",
    expected: "platform/payments/billing-service",
  },
  {
    name: "gitlab at the segment limit",
    provider: "gitlab",
    raw: deepGitlabPath(REPOSITORY_PATH_SEGMENT_LIMITS.gitlab.max),
    expected: deepGitlabPath(REPOSITORY_PATH_SEGMENT_LIMITS.gitlab.max),
  },
  {
    name: "gitlab over the segment limit",
    provider: "gitlab",
    raw: deepGitlabPath(REPOSITORY_PATH_SEGMENT_LIMITS.gitlab.max + 1),
    expected: null,
  },
  { name: "gitlab with one segment", provider: "gitlab", raw: "platform", expected: null },
];

describe("repositoryLookup", () => {
  it("freezes the shared lookup limits", () => {
    expect(REPOSITORY_LOOKUP_LIMITS).toEqual({
      pathChars: 255,
      queryChars: 100,
      searchPageSize: 20,
      searchMaxPages: 10,
      hostsPerProvider: 8,
      hostChars: 253,
      descriptionChars: 200,
    });
    expect(REPOSITORY_PROVIDERS).toEqual(["github", "gitlab"]);
    expect(REPOSITORY_PATH_SEGMENT_LIMITS).toEqual({
      github: { min: 2, max: 2 },
      gitlab: { min: 2, max: 20 },
    });
  });

  it("recognizes only the closed provider set", () => {
    expect(isRepositoryProvider("github")).toBe(true);
    expect(isRepositoryProvider("gitlab")).toBe(true);
    expect(isRepositoryProvider("bitbucket")).toBe(false);
    expect(isRepositoryProvider(null)).toBe(false);
    expect(isRepositoryProvider(undefined)).toBe(false);
  });

  it("bounds repository hostnames", () => {
    expect(isRepositoryHost("github.com")).toBe(true);
    expect(isRepositoryHost("gitlab.example.com")).toBe(true);
    expect(isRepositoryHost("a")).toBe(true);
    expect(isRepositoryHost("a".repeat(REPOSITORY_LOOKUP_LIMITS.hostChars))).toBe(true);
    expect(isRepositoryHost("a".repeat(REPOSITORY_LOOKUP_LIMITS.hostChars + 1))).toBe(false);
    expect(isRepositoryHost("")).toBe(false);
    expect(isRepositoryHost("-github.com")).toBe(false);
    expect(isRepositoryHost("github.com-")).toBe(false);
    expect(isRepositoryHost("github.com:443")).toBe(false);
    expect(isRepositoryHost("git hub.com")).toBe(false);
    expect(isRepositoryHost("github.com\n")).toBe(false);
  });

  it.each(pathCases)("parses $provider path: $name", ({ provider, raw, expected }) => {
    expect(parseRepositoryPath(provider, raw)).toBe(expected);
  });

  it("re-parses a normalized path to itself", () => {
    const normalized = parseRepositoryPath("github", " acme/storefront-api.git ");
    expect(normalized).toBe("acme/storefront-api");
    expect(parseRepositoryPath("github", normalized ?? "")).toBe(normalized);
  });
});
