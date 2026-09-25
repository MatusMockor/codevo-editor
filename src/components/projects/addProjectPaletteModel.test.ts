import { describe, expect, it } from "vitest";
import { addProjectPaletteGroups } from "./addProjectPaletteModel";

const base = {
  query: "",
  environment: "local" as const,
  hosts: {
    github: { kind: "ready" as const, host: "github.com" },
    gitlab: { kind: "missing" as const },
  },
  recent: [
    { path: "/Users/dev/code/billing-worker", label: "billing-worker", openedAtMs: 1_000 },
    { path: "/Users/dev/archive/orders-api-v1", label: "orders-api-v1", openedAtMs: null },
  ],
  home: "/Users/dev",
  nowMs: 1_000 + 3 * 86_400_000,
  cloneAvailable: true,
};

describe("addProjectPaletteGroups", () => {
  it("lists sources and recent folders like the mockup", () => {
    const groups = addProjectPaletteGroups(base);
    expect(groups.map((group) => group.label)).toEqual(["Sources", "Recent"]);
    expect(groups[0].items).toEqual([
      {
        kind: "source",
        key: "source:folder",
        id: "folder",
        title: "Open folder",
        description: "Browse a folder on disk",
        shortcut: "⌘O",
        chip: null,
        disabledReason: null,
      },
      {
        kind: "source",
        key: "source:gitUrl",
        id: "gitUrl",
        title: "Git URL",
        description: "Clone from an HTTPS or SSH URL",
        shortcut: null,
        chip: null,
        disabledReason: null,
      },
      {
        kind: "source",
        key: "source:github",
        id: "github",
        title: "GitHub repository",
        description: "Clone owner/repo",
        shortcut: null,
        chip: { tone: "ok", label: "Connected" },
        disabledReason: null,
      },
      {
        kind: "source",
        key: "source:gitlab",
        id: "gitlab",
        title: "GitLab repository",
        description: "Clone group/project",
        shortcut: null,
        chip: { tone: "warn", label: "Setup required" },
        disabledReason: "Install glab on This computer, then sign in.",
      },
    ]);
    expect(groups[1].items).toEqual([
      {
        kind: "recent",
        key: "recent:/Users/dev/code/billing-worker",
        path: "/Users/dev/code/billing-worker",
        title: "billing-worker",
        description: "~/code/billing-worker",
        age: "3d",
      },
      {
        kind: "recent",
        key: "recent:/Users/dev/archive/orders-api-v1",
        path: "/Users/dev/archive/orders-api-v1",
        title: "orders-api-v1",
        description: "~/archive/orders-api-v1",
        age: null,
      },
    ]);
  });

  it("filters by query and offers pasted URLs and paths first", () => {
    expect(
      addProjectPaletteGroups({ ...base, query: "git" })[0].items.map((item) => item.key),
    ).toEqual(["source:gitUrl", "source:github", "source:gitlab"]);
    const pasted = addProjectPaletteGroups({
      ...base,
      query: "https://github.com/acme/web-dashboard",
    });
    expect(pasted).toEqual([
      {
        label: "Clone",
        items: [
          {
            kind: "cloneUrl",
            key: "clone:https://github.com/acme/web-dashboard",
            url: "https://github.com/acme/web-dashboard",
            title: "Clone repository",
            description: "https://github.com/acme/web-dashboard",
          },
        ],
      },
    ]);
    const path = addProjectPaletteGroups({ ...base, query: "~/code/app" });
    expect(path[0].items[0]).toEqual({
      kind: "openPath",
      key: "path:/Users/dev/code/app",
      path: "/Users/dev/code/app",
      title: "Open ~/code/app",
      description: "Add this folder as a project",
    });
    expect(addProjectPaletteGroups({ ...base, query: "zzz" })).toEqual([]);
  });

  it("refuses the home folder, the disk root and ancestors of home instead of offering them", () => {
    const cases = [
      { query: "~", title: "Open ~", reason: "Choose a project folder, not your home folder." },
      { query: "~/", title: "Open ~/", reason: "Choose a project folder, not your home folder." },
      { query: "/", title: "Open /", reason: "Choose a project folder, not the root of the disk." },
      {
        query: "/Users",
        title: "Open /Users",
        reason: "Choose a project folder, not a folder that contains your home folder.",
      },
      {
        query: "/users/DEV",
        title: "Open /users/DEV",
        reason: "Choose a project folder, not your home folder.",
      },
    ];
    for (const entry of cases) {
      const groups = addProjectPaletteGroups({ ...base, query: entry.query });
      expect(groups).toHaveLength(1);
      expect(groups[0].items).toHaveLength(1);
      expect(groups[0].items[0]).toMatchObject({
        kind: "refusedPath",
        title: entry.title,
        description: entry.reason,
      });
    }
    expect(addProjectPaletteGroups({ ...base, home: null, query: "/" })[0].items[0]).toMatchObject({
      kind: "refusedPath",
    });
  });

  it("keeps a pasted credential URL out of the rows", () => {
    const pasted = addProjectPaletteGroups({ ...base, query: "https://ghp_x@github.com/a/b.git" });
    expect(pasted[0].items[0]).toMatchObject({
      kind: "cloneUrl",
      description: "URL with credentials - rejected",
    });
  });

  it("does not offer a pasted URL as a clone when cloning is unavailable", () => {
    const groups = addProjectPaletteGroups({
      ...base,
      cloneAvailable: false,
      query: "https://github.com/acme/web-dashboard",
    });
    expect(groups.flatMap((group) => group.items).map((item) => item.kind)).not.toContain(
      "cloneUrl",
    );
  });

  it("maps host states and missing clone support to disabled rows", () => {
    const signedOut = addProjectPaletteGroups({
      ...base,
      hosts: {
        github: { kind: "signedOut", host: "github.com" },
        gitlab: { kind: "ready", host: "gitlab.com" },
      },
    })[0].items;
    expect(signedOut[2]).toMatchObject({
      chip: { tone: "warn", label: "Sign in required" },
      disabledReason: null,
    });
    expect(signedOut[3]).toMatchObject({
      chip: { tone: "ok", label: "Connected" },
      disabledReason: null,
    });
    const noClone = addProjectPaletteGroups({ ...base, cloneAvailable: false })[0].items;
    expect(
      noClone
        .slice(1)
        .every(
          (item) =>
            item.kind === "source" &&
            item.disabledReason === "Cloning is not available on this computer.",
        ),
    ).toBe(true);
  });

  it("shows server sources and no recent folders for a server", () => {
    const groups = addProjectPaletteGroups({ ...base, environment: "remote" });
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.key)).toEqual([
      "source:serverProject",
      "source:serverClone",
    ]);
  });
});
