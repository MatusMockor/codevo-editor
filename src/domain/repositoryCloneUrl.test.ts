import { describe, expect, it } from "vitest";
import {
  cloneFolderName,
  cloneUrlFor,
  isCloneBranchName,
  isCloneFolderName,
  parseRepositoryCloneUrl,
  type CloneProtocol,
  type RepositoryIdentity,
} from "./repositoryCloneUrl";
import type { RepositoryInfo } from "./repositoryLookup";

type AcceptedCase = Readonly<{ name: string; url: string; identity: RepositoryIdentity }>;

const githubInfo: RepositoryInfo = {
  provider: "github",
  host: "github.com",
  fullPath: "acme/storefront-api",
  description: "Storefront API service",
  visibility: "public",
  defaultBranch: "main",
  sshUrl: "git@github.com:acme/storefront-api.git",
  httpsUrl: "https://github.com/acme/storefront-api.git",
};

const acceptedCases: readonly AcceptedCase[] = [
  {
    name: "https clone url",
    url: "https://github.com/acme/storefront-api.git",
    identity: { host: "github.com", path: "acme/storefront-api" },
  },
  {
    name: "https clone url without a .git suffix",
    url: "https://github.com/acme/storefront-api",
    identity: { host: "github.com", path: "acme/storefront-api" },
  },
  {
    name: "scp style clone url",
    url: "git@github.com:acme/storefront-api.git",
    identity: { host: "github.com", path: "acme/storefront-api" },
  },
  {
    name: "ssh clone url with a port",
    url: "ssh://git@gitlab.example.com:2222/platform/billing-service.git",
    identity: { host: "gitlab.example.com", path: "platform/billing-service" },
  },
  {
    name: "ssh clone url without a port",
    url: "ssh://git@gitlab.example.com/platform/billing-service.git",
    identity: { host: "gitlab.example.com", path: "platform/billing-service" },
  },
  {
    name: "ssh clone url with the highest port",
    url: "ssh://git@gitlab.example.com:65535/platform/billing-service",
    identity: { host: "gitlab.example.com", path: "platform/billing-service" },
  },
  {
    name: "ssh clone url with a zero padded port",
    url: "ssh://git@gitlab.example.com:02222/platform/billing-service",
    identity: { host: "gitlab.example.com", path: "platform/billing-service" },
  },
  {
    name: "uppercase host is normalized, path case is preserved",
    url: "https://GitHub.COM/Acme/Storefront-API.git",
    identity: { host: "github.com", path: "Acme/Storefront-API" },
  },
  {
    name: "deeply nested gitlab path",
    url: "https://gitlab.example.com/platform/payments/billing-service.git",
    identity: { host: "gitlab.example.com", path: "platform/payments/billing-service" },
  },
  {
    name: "dotted repository name keeps its dots",
    url: "https://github.com/acme/my.repo.git",
    identity: { host: "github.com", path: "acme/my.repo" },
  },
  {
    name: "bare .git segment is not stripped to nothing",
    url: "https://github.com/acme/.git",
    identity: { host: "github.com", path: "acme/.git" },
  },
  {
    name: "underscore username in an scp url",
    url: "_build@gitlab.example.com:platform/billing-service.git",
    identity: { host: "gitlab.example.com", path: "platform/billing-service" },
  },
];

const rejectedCases: readonly (readonly [string, string])[] = [
  ["absolute local path", "/tmp/repo"],
  ["file url", "file:///tmp/repo"],
  ["git option injection", "-uanything"],
  ["https url with credentials", "https://token@github.com/acme/storefront-api"],
  ["https url with a query", "https://github.com/acme/storefront-api.git?token=x"],
  ["https url with a fragment", "https://github.com/acme/storefront-api.git#main"],
  ["https url with a percent escape", "https://github.com/%2facme/storefront-api"],
  ["scp url with a parent segment", "git@github.com:../storefront-api"],
  ["https url with port zero", "https://github.com:0/acme/storefront-api"],
  ["https url with an out of range port", "https://github.com:65536/acme/storefront-api"],
  ["https url with any port", "https://github.com:443/acme/storefront-api"],
  ["https url with a trailing newline", "https://github.com/acme/storefront-api\n"],
  ["https url with a NUL byte", "https://github.com/acme/storefront-api\u0000"],
  ["https url with a space", "https://github.com/acme/storefront api"],
  ["https url with a trailing slash", "https://github.com/acme/storefront-api/"],
  ["https url without a path", "https://github.com"],
  ["https url with an empty path", "https://github.com/"],
  ["ssh url without a username", "ssh://gitlab.example.com/platform/billing-service"],
  ["ssh url with an empty username", "ssh://@gitlab.example.com/platform/billing-service"],
  ["ssh url with port zero", "ssh://git@gitlab.example.com:0/platform/billing-service"],
  ["ssh url with a non numeric port", "ssh://git@gitlab.example.com:ssh/platform/billing-service"],
  ["ssh url with an out of range port", "ssh://git@gitlab.example.com:65536/platform/billing"],
  ["scp url without a username", "github.com:acme/storefront-api"],
  ["scp url with an absolute path", "git@github.com:/acme/storefront-api"],
  ["scp url with a second colon", "git@github.com:2222:acme/storefront-api"],
  ["scp url with a dash leading username", "-oProxy@github.com:acme/storefront-api"],
  ["host with a trailing dash", "https://github.com-/acme/storefront-api"],
  ["host with a leading dot", "https://.github.com/acme/storefront-api"],
  ["non ascii host", "https://gïthub.com/acme/storefront-api"],
  ["non ascii path", "https://github.com/acme/störefront"],
  ["over long url", `https://github.com/acme/${"a".repeat(2048)}`],
  ["git protocol url", "git://github.com/acme/storefront-api.git"],
  ["ssh url with a current directory segment", "ssh://git@github.com/acme/./storefront-api"],
];

describe("parseRepositoryCloneUrl", () => {
  it.each(acceptedCases)("accepts $name", ({ url, identity }) => {
    expect(parseRepositoryCloneUrl(url)).toEqual(identity);
  });

  it.each(rejectedCases)("rejects %s", (_name, url) => {
    expect(parseRepositoryCloneUrl(url)).toBeNull();
  });

  it("accepts a url at the character limit", () => {
    const prefix = "https://github.com/acme/";
    const url = `${prefix}${"a".repeat(2048 - prefix.length)}`;
    expect(url).toHaveLength(2048);
    expect(parseRepositoryCloneUrl(url)).not.toBeNull();
    expect(parseRepositoryCloneUrl(`${url}a`)).toBeNull();
  });

  it("returns frozen identities", () => {
    const identity = parseRepositoryCloneUrl("https://github.com/acme/storefront-api.git");
    expect(identity).not.toBeNull();
    expect(Object.isFrozen(identity)).toBe(true);
  });
});

describe("cloneUrlFor", () => {
  it("selects the url matching the protocol", () => {
    expect(cloneUrlFor(githubInfo, "ssh")).toBe("git@github.com:acme/storefront-api.git");
    expect(cloneUrlFor(githubInfo, "https")).toBe("https://github.com/acme/storefront-api.git");
  });

  it("returns null when the protocol has no url", () => {
    expect(cloneUrlFor({ ...githubInfo, sshUrl: null }, "ssh")).toBeNull();
    expect(cloneUrlFor({ ...githubInfo, httpsUrl: null }, "https")).toBeNull();
  });

  it("returns null when the stored url fails the clone grammar", () => {
    expect(cloneUrlFor({ ...githubInfo, sshUrl: "git@github.com:acme/repo?x" }, "ssh")).toBeNull();
    expect(
      cloneUrlFor({ ...githubInfo, httpsUrl: "https://token@github.com/acme/repo" }, "https"),
    ).toBeNull();
  });

  it("returns null when the url scheme contradicts the protocol", () => {
    expect(
      cloneUrlFor({ ...githubInfo, sshUrl: "https://github.com/acme/storefront-api.git" }, "ssh"),
    ).toBeNull();
    expect(
      cloneUrlFor({ ...githubInfo, httpsUrl: "git@github.com:acme/storefront-api.git" }, "https"),
    ).toBeNull();
  });

  it("rejects an unsupported protocol", () => {
    expect(() => cloneUrlFor(githubInfo, "git" as CloneProtocol)).toThrow(TypeError);
  });
});

describe("cloneFolderName", () => {
  it("uses the last identity segment", () => {
    expect(cloneFolderName({ host: "github.com", path: "acme/storefront-api" })).toBe(
      "storefront-api",
    );
    expect(
      cloneFolderName({ host: "gitlab.example.com", path: "platform/payments/billing_service" }),
    ).toBe("billing_service");
  });

  it("returns null when the last segment is not a folder name", () => {
    expect(cloneFolderName({ host: "github.com", path: "acme/my.repo" })).toBeNull();
    expect(cloneFolderName({ host: "github.com", path: "acme/.git" })).toBeNull();
    expect(cloneFolderName({ host: "github.com", path: `acme/${"a".repeat(65)}` })).toBeNull();
    expect(cloneFolderName({ host: "github.com", path: "" })).toBeNull();
  });
});

describe("isCloneFolderName", () => {
  it("accepts bounded folder names", () => {
    expect(isCloneFolderName("a")).toBe(true);
    expect(isCloneFolderName("0")).toBe(true);
    expect(isCloneFolderName("storefront-api")).toBe(true);
    expect(isCloneFolderName("storefront_api")).toBe(true);
    expect(isCloneFolderName("a".repeat(64))).toBe(true);
  });

  it("rejects everything outside the folder grammar", () => {
    expect(isCloneFolderName("")).toBe(false);
    expect(isCloneFolderName("a".repeat(65))).toBe(false);
    expect(isCloneFolderName("-storefront")).toBe(false);
    expect(isCloneFolderName("_storefront")).toBe(false);
    expect(isCloneFolderName("my.repo")).toBe(false);
    expect(isCloneFolderName("store front")).toBe(false);
    expect(isCloneFolderName("store/front")).toBe(false);
    expect(isCloneFolderName("store\nfront")).toBe(false);
  });
});

describe("isCloneBranchName", () => {
  const accepted = [
    "main",
    "feature/project-clone",
    "release/1.0",
    "v2.0.1",
    "a".repeat(255),
    "renovate/lock-file-maintenance",
  ];
  const rejected = [
    "",
    "@",
    "-main",
    "/main",
    "main/",
    "main.",
    "a..b",
    "a//b",
    "a/.b",
    ".hidden",
    "a/b.lock",
    "b.lock",
    "a@{1}",
    "HEAD~1",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "a b",
    "a\u0000b",
    "a\u007fb",
    "a".repeat(256),
  ];

  it("accepts every branch the runner accepts", () => {
    for (const branch of accepted) expect(isCloneBranchName(branch), branch).toBe(true);
  });

  it("rejects every branch the runner rejects", () => {
    for (const branch of rejected) expect(isCloneBranchName(branch), branch).toBe(false);
  });
});
