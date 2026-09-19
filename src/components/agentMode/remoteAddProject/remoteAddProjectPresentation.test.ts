import { describe, expect, it } from "vitest";
import type {
  RemoteAddProjectCandidate,
  RemoteAddProjectSourceAvailability,
  RemoteAddProjectStep,
} from "../../../application/useRemoteAddProject";
import type { AgentProjectDescriptor } from "../../../domain/agentProject";
import type { RepositoryInfo, RemoteProjectSourceKind } from "../../../domain/repositoryLookup";
import {
  remoteAddProjectCandidateView,
  remoteAddProjectCloneActive,
  remoteAddProjectEnterHint,
  remoteAddProjectHttpsWarning,
  remoteAddProjectMaxEntryChars,
  remoteAddProjectPlaceholder,
  remoteAddProjectPrimaryLabel,
  remoteAddProjectProtocolOptions,
  remoteAddProjectRowClassName,
  remoteAddProjectSourceRows,
  remoteAddProjectStepTitle,
  remoteAddProjectServerProjects,
} from "./remoteAddProjectPresentation";

const READY: RemoteAddProjectSourceAvailability = { status: "ready" };

describe("remoteAddProjectPresentation", () => {
  it("orders the sources and keeps ready rows without a reason", () => {
    const rows = remoteAddProjectSourceRows(availability({}));

    expect(rows.map((row) => row.kind)).toEqual([
      "serverProject",
      "gitUrl",
      "github",
      "gitlab",
    ] satisfies RemoteProjectSourceKind[]);
    expect(rows.every((row) => row.reason === null)).toBe(true);
    expect(rows[2]?.title).toBe("GitHub repository");
    expect(rows[3]?.description).toBe("Clone group/project");
  });

  it("explains every unavailable reason truthfully", () => {
    const reasons = [
      "cliMissing",
      "notAuthenticated",
      "hostsFailed",
      "cloningUnsupported",
      "lookupUnavailable",
    ] as const;

    const messages = reasons.map((reason) => {
      const rows = remoteAddProjectSourceRows(
        availability({ gitlab: { status: "unavailable", reason } }),
      );
      return rows[3]?.reason ?? "";
    });

    expect(messages).toEqual([
      "The GitLab CLI (glab) was not found on this machine. Install `glab`, then retry.",
      "The GitLab CLI (glab) is not logged in to any host. Run `glab auth login` in a terminal, then retry.",
      "The GitLab CLI (glab) host check did not finish.",
      "This server cannot clone repositories.",
      "Repository lookup is unavailable in this build.",
    ]);
    expect(new Set(messages).size).toBe(reasons.length);
  });

  it("keeps a checking source without a reason", () => {
    const rows = remoteAddProjectSourceRows(availability({ github: { status: "checking" } }));

    expect(rows[2]?.availability.status).toBe("checking");
    expect(rows[2]?.reason).toBeNull();
  });

  it("labels every step", () => {
    const steps: readonly RemoteAddProjectStep[] = [
      { kind: "sources" },
      { kind: "serverProjects" },
      { kind: "urlEntry", entry: "", lookup: { status: "idle" } },
      {
        kind: "repository",
        provider: "github",
        host: "github.com",
        hosts: [],
        hostsTruncated: false,
        entry: "",
        lookup: { status: "idle" },
      },
      {
        kind: "repository",
        provider: "gitlab",
        host: "gitlab.com",
        hosts: [],
        hostsTruncated: false,
        entry: "",
        lookup: { status: "idle" },
      },
      confirmStep(),
    ];

    expect(steps.map(remoteAddProjectPlaceholder)).toEqual([
      "Filter sources",
      "Filter server projects",
      "Enter Git clone URL",
      "Enter GitHub repository (owner/repo)",
      "Enter GitLab repository (group/project)",
      "Folder name",
    ]);
    expect(steps.map(remoteAddProjectStepTitle)).toEqual([
      "Add project",
      "Server projects",
      "Git URL",
      "GitHub repository",
      "GitLab repository",
      "Confirm clone",
    ]);
    expect(steps.map(remoteAddProjectPrimaryLabel)).toEqual([
      "Continue",
      "Open project",
      "Continue",
      "Look up",
      "Look up",
      "Clone on server",
    ]);
    expect(steps.map(remoteAddProjectEnterHint)).toEqual([
      "select",
      "open",
      "continue",
      "look up",
      "look up",
      "clone",
    ]);
    expect(steps.map(remoteAddProjectMaxEntryChars)).toEqual([120, 120, 2048, 255, 255, 120]);
  });

  it("describes the candidate without leaking the clone URL", () => {
    const repository = remoteAddProjectCandidateView({
      kind: "repository",
      repository: repositoryInfo({}),
    });
    const url = remoteAddProjectCandidateView({
      kind: "url",
      url: "https://example.test/group/project.git",
      identity: { host: "example.test", path: "group/project" },
    });

    expect(repository).toEqual({
      provider: "github",
      title: "octo/editor",
      host: "github.com",
      visibility: "Private",
      defaultBranch: "main",
    });
    expect(url.title).toBe("group/project");
    expect(url.visibility).toBe("Visibility unknown");
    expect(JSON.stringify(url)).not.toContain("https://");
  });

  it("disables a protocol whose URL is null", () => {
    const noSsh = remoteAddProjectProtocolOptions({
      kind: "repository",
      repository: repositoryInfo({ sshUrl: null }),
    });
    const urlCandidate = remoteAddProjectProtocolOptions({
      kind: "url",
      url: "git@example.test:group/project.git",
      identity: { host: "example.test", path: "group/project" },
    });

    expect(noSsh.map((option) => [option.protocol, option.available])).toEqual([
      ["ssh", false],
      ["https", true],
    ]);
    expect(urlCandidate.map((option) => option.available)).toEqual([true, false]);
  });

  it("warns about anonymous HTTPS unless the repository is public", () => {
    const privateRepository: RemoteAddProjectCandidate = {
      kind: "repository",
      repository: repositoryInfo({}),
    };
    const publicRepository: RemoteAddProjectCandidate = {
      kind: "repository",
      repository: repositoryInfo({ visibility: "public" }),
    };

    expect(remoteAddProjectHttpsWarning(privateRepository, "ssh")).toBeNull();
    expect(remoteAddProjectHttpsWarning(publicRepository, "https")).toBeNull();
    expect(remoteAddProjectHttpsWarning(privateRepository, "https")).toContain("anonymously");
  });

  it("treats only queued and running clones as active", () => {
    const statuses = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "interrupted",
      "cancelled",
    ] as const;

    expect(statuses.map(remoteAddProjectCloneActive)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("marks the active row class", () => {
    expect(remoteAddProjectRowClassName(false)).toBe(
      "quick-open-result agent-remote-add-project__row",
    );
    expect(remoteAddProjectRowClassName(true)).toContain(" active");
  });

  it("keeps only trusted projects of the selected server", () => {
    expect(
      remoteAddProjectServerProjects(
        [
          project("remote:linux:runner-1:alpha", "alpha"),
          { ...project("remote:linux:runner-1:beta", "beta"), trust: "untrusted" },
          { ...project("remote:linux:runner-1:gamma", "gamma"), origin: "closed-tab-live-tasks" },
          project("remote:other:runner-9:delta", "delta"),
          project("/local/app", "app"),
        ],
        "linux",
      ),
    ).toEqual([{ key: "remote:linux:runner-1:alpha", label: "alpha" }]);
  });

  it("fails closed without a selected server", () => {
    expect(remoteAddProjectServerProjects([project("remote:linux:r:a", "a")], null)).toEqual([]);
    expect(remoteAddProjectServerProjects([], "linux")).toEqual([]);
  });
});

function availability(
  overrides: Partial<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>>,
): Readonly<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>> {
  return {
    serverProject: READY,
    gitUrl: READY,
    github: READY,
    gitlab: READY,
    ...overrides,
  };
}

function repositoryInfo(overrides: Partial<RepositoryInfo>): RepositoryInfo {
  return {
    provider: "github",
    host: "github.com",
    fullPath: "octo/editor",
    description: null,
    visibility: "private",
    defaultBranch: "main",
    sshUrl: "git@github.com:octo/editor.git",
    httpsUrl: "https://github.com/octo/editor.git",
    ...overrides,
  };
}

function confirmStep(): RemoteAddProjectStep {
  return {
    kind: "confirm",
    candidate: { kind: "repository", repository: repositoryInfo({}) },
    name: "editor",
    branch: "",
    protocol: "ssh",
    nameError: null,
    branchError: null,
    existingProjectKey: null,
    submitError: null,
    submitting: false,
  };
}

function project(rootKey: string, label: string): AgentProjectDescriptor {
  return {
    rootKey,
    rootPath: rootKey,
    ownerId: rootKey,
    label,
    generation: 1,
    trust: "trusted",
    origin: "active-tab",
    repositories: [
      { repositoryRoot: rootKey, repositoryRelativePath: "", mapping: { rootRelativePath: "" } },
    ],
    isolationPolicy: "auto",
    leaseToken: null,
  };
}
