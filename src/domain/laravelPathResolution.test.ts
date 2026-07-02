import { describe, expect, it } from "vitest";
import {
  resolveLaravelConfigTarget,
  resolveLaravelEnvTarget,
  resolveLaravelTransTarget,
  resolveLaravelViewTarget,
  resolveLaravelViewWorkspaceTargets,
  resolveLaravelWorkspaceFileTarget,
  resolveLaravelWorkspaceFileTargets,
} from "./laravelPathResolution";

describe("resolveLaravelConfigTarget", () => {
  it("maps a single-segment key to its file plus key path", () => {
    expect(resolveLaravelConfigTarget("app.name")).toEqual({
      relativeFilePath: "config/app.php",
      keyPath: ["name"],
    });
  });

  it("maps a nested key to the remaining key path", () => {
    expect(resolveLaravelConfigTarget("services.stripe.key")).toEqual({
      relativeFilePath: "config/services.php",
      keyPath: ["stripe", "key"],
    });
  });

  it("maps a file-only literal to an empty key path", () => {
    expect(resolveLaravelConfigTarget("app")).toEqual({
      relativeFilePath: "config/app.php",
      keyPath: [],
    });
  });

  it("trims surrounding whitespace from the literal", () => {
    expect(resolveLaravelConfigTarget("  app.name  ")).toEqual({
      relativeFilePath: "config/app.php",
      keyPath: ["name"],
    });
  });

  it("returns null for the empty literal", () => {
    expect(resolveLaravelConfigTarget("")).toBeNull();
  });

  it("returns null for a whitespace-only literal", () => {
    expect(resolveLaravelConfigTarget("   ")).toBeNull();
  });

  it("returns null for a leading-dot literal", () => {
    expect(resolveLaravelConfigTarget(".name")).toBeNull();
  });

  it("returns null for an empty inner segment", () => {
    expect(resolveLaravelConfigTarget("app..name")).toBeNull();
  });

  it("returns null for a path-traversing file segment", () => {
    expect(resolveLaravelConfigTarget("../secrets.value")).toBeNull();
  });

  it("returns null for a literal containing a slash", () => {
    expect(resolveLaravelConfigTarget("app/name")).toBeNull();
  });
});

describe("resolveLaravelViewTarget", () => {
  it("maps a dotted view name to blade and php candidates", () => {
    expect(resolveLaravelViewTarget("admin.dashboard")).toEqual({
      relativeFilePaths: [
        "resources/views/admin/dashboard.blade.php",
        "resources/views/admin/dashboard.php",
      ],
    });
  });

  it("maps a single-segment view name", () => {
    expect(resolveLaravelViewTarget("welcome")).toEqual({
      relativeFilePaths: [
        "resources/views/welcome.blade.php",
        "resources/views/welcome.php",
      ],
    });
  });

  it("accepts slash notation equivalently to dot notation", () => {
    expect(resolveLaravelViewTarget("admin/dashboard")).toEqual({
      relativeFilePaths: [
        "resources/views/admin/dashboard.blade.php",
        "resources/views/admin/dashboard.php",
      ],
    });
  });

  it("trims surrounding whitespace from the view name", () => {
    expect(resolveLaravelViewTarget("  admin.dashboard  ")).toEqual({
      relativeFilePaths: [
        "resources/views/admin/dashboard.blade.php",
        "resources/views/admin/dashboard.php",
      ],
    });
  });

  it("returns null for the empty literal", () => {
    expect(resolveLaravelViewTarget("")).toBeNull();
  });

  it("returns null for a whitespace-only literal", () => {
    expect(resolveLaravelViewTarget("  ")).toBeNull();
  });

  it("returns null for an empty inner segment", () => {
    expect(resolveLaravelViewTarget("admin..dashboard")).toBeNull();
  });

  it("returns null for a path-traversing segment", () => {
    expect(resolveLaravelViewTarget("..admin")).toBeNull();
  });

  it("returns null for a vendor namespaced view", () => {
    expect(resolveLaravelViewTarget("package::admin.dashboard")).toBeNull();
  });
});

describe("resolveLaravelWorkspaceFileTarget", () => {
  it("maps a safe relative path under the requested workspace root", () => {
    expect(
      resolveLaravelWorkspaceFileTarget(
        "/workspace-a",
        "resources/views/comments/index.blade.php",
      ),
    ).toEqual({
      path: "/workspace-a/resources/views/comments/index.blade.php",
      relativePath: "resources/views/comments/index.blade.php",
    });
  });

  it("normalizes Windows separators without changing the workspace root", () => {
    expect(
      resolveLaravelWorkspaceFileTarget(
        "C:\\project\\",
        "resources\\views\\comments\\index.blade.php",
      ),
    ).toEqual({
      path: "C:/project/resources/views/comments/index.blade.php",
      relativePath: "resources/views/comments/index.blade.php",
    });
  });

  it("rejects paths that could escape or bypass the workspace root", () => {
    expect(
      resolveLaravelWorkspaceFileTarget("/workspace", "../secrets/.env"),
    ).toBeNull();
    expect(
      resolveLaravelWorkspaceFileTarget("/workspace", "resources/../.env"),
    ).toBeNull();
    expect(
      resolveLaravelWorkspaceFileTarget("/workspace", "/etc/passwd"),
    ).toBeNull();
    expect(
      resolveLaravelWorkspaceFileTarget("/workspace", "C:/other/passwd"),
    ).toBeNull();
    expect(
      resolveLaravelWorkspaceFileTarget("", "resources/views/index.blade.php"),
    ).toBeNull();
  });

  it("rejects top-level dependency directory candidates", () => {
    expect(
      resolveLaravelWorkspaceFileTarget(
        "/workspace",
        "vendor/package/views/index.blade.php",
      ),
    ).toBeNull();
    expect(
      resolveLaravelWorkspaceFileTarget(
        "/workspace",
        "node_modules/package/views/index.blade.php",
      ),
    ).toBeNull();
  });

  it("keeps resources/views/vendor as an app-owned Laravel view path", () => {
    expect(
      resolveLaravelWorkspaceFileTarget(
        "/workspace",
        "resources/views/vendor/mail/html/message.blade.php",
      ),
    ).toEqual({
      path: "/workspace/resources/views/vendor/mail/html/message.blade.php",
      relativePath: "resources/views/vendor/mail/html/message.blade.php",
    });
  });

  it("deduplicates candidate paths while preserving order", () => {
    expect(
      resolveLaravelWorkspaceFileTargets("/workspace", [
        "resources/views/dashboard.blade.php",
        "resources/views/dashboard.blade.php",
        "vendor/package/dashboard.blade.php",
        "resources/views/dashboard.php",
      ]),
    ).toEqual([
      {
        path: "/workspace/resources/views/dashboard.blade.php",
        relativePath: "resources/views/dashboard.blade.php",
      },
      {
        path: "/workspace/resources/views/dashboard.php",
        relativePath: "resources/views/dashboard.php",
      },
    ]);
  });
});

describe("resolveLaravelViewWorkspaceTargets", () => {
  it("maps a dotted view name to absolute workspace-bound candidates", () => {
    expect(resolveLaravelViewWorkspaceTargets("/workspace-a", "comments.index")).toEqual([
      {
        path: "/workspace-a/resources/views/comments/index.blade.php",
        relativePath: "resources/views/comments/index.blade.php",
      },
      {
        path: "/workspace-a/resources/views/comments/index.php",
        relativePath: "resources/views/comments/index.php",
      },
    ]);
  });

  it("returns no targets for package namespaced or traversal-like views", () => {
    expect(resolveLaravelViewWorkspaceTargets("/workspace", "package::view")).toEqual(
      [],
    );
    expect(resolveLaravelViewWorkspaceTargets("/workspace", "../view")).toEqual([]);
  });
});

describe("resolveLaravelTransTarget", () => {
  it("maps a group.key literal to group candidates, key path and JSON fallback", () => {
    expect(resolveLaravelTransTarget("messages.welcome")).toEqual({
      relativeFilePaths: [
        "lang/en/messages.php",
        "resources/lang/en/messages.php",
      ],
      keyPath: ["welcome"],
      jsonFilePaths: ["lang/en.json", "resources/lang/en.json"],
      jsonKey: "messages.welcome",
    });
  });

  it("maps a nested key to the remaining key path", () => {
    expect(resolveLaravelTransTarget("messages.user.greeting")).toEqual({
      relativeFilePaths: [
        "lang/en/messages.php",
        "resources/lang/en/messages.php",
      ],
      keyPath: ["user", "greeting"],
      jsonFilePaths: ["lang/en.json", "resources/lang/en.json"],
      jsonKey: "messages.user.greeting",
    });
  });

  it("honours an explicit locale for the group and JSON candidates", () => {
    expect(resolveLaravelTransTarget("messages.welcome", "sk")).toEqual({
      relativeFilePaths: [
        "lang/sk/messages.php",
        "resources/lang/sk/messages.php",
      ],
      keyPath: ["welcome"],
      jsonFilePaths: ["lang/sk.json", "resources/lang/sk.json"],
      jsonKey: "messages.welcome",
    });
  });

  it("treats a key-less literal with spaces as a JSON translation", () => {
    expect(resolveLaravelTransTarget("Welcome to our site")).toEqual({
      relativeFilePaths: [],
      keyPath: [],
      jsonFilePaths: ["lang/en.json", "resources/lang/en.json"],
      jsonKey: "Welcome to our site",
    });
  });

  it("treats a trailing-dot sentence as a JSON-only translation", () => {
    expect(resolveLaravelTransTarget("Welcome to our site.")).toEqual({
      relativeFilePaths: [],
      keyPath: [],
      jsonFilePaths: ["lang/en.json", "resources/lang/en.json"],
      jsonKey: "Welcome to our site.",
    });
  });

  it("uses the explicit locale for JSON translation candidates", () => {
    expect(resolveLaravelTransTarget("Welcome to our site", "sk")).toEqual({
      relativeFilePaths: [],
      keyPath: [],
      jsonFilePaths: ["lang/sk.json", "resources/lang/sk.json"],
      jsonKey: "Welcome to our site",
    });
  });

  it("returns null for the empty literal", () => {
    expect(resolveLaravelTransTarget("")).toBeNull();
  });

  it("returns null for a whitespace-only literal", () => {
    expect(resolveLaravelTransTarget("   ")).toBeNull();
  });

  it("falls back to JSON-only for an empty inner segment", () => {
    expect(resolveLaravelTransTarget("messages..welcome")).toEqual({
      relativeFilePaths: [],
      keyPath: [],
      jsonFilePaths: ["lang/en.json", "resources/lang/en.json"],
      jsonKey: "messages..welcome",
    });
  });

  it("returns null for a path-traversing group", () => {
    expect(resolveLaravelTransTarget("../messages.welcome")).toBeNull();
  });

  it("returns null for a vendor namespaced translation", () => {
    expect(resolveLaravelTransTarget("package::messages.welcome")).toBeNull();
  });

  it("returns null for an invalid locale", () => {
    expect(resolveLaravelTransTarget("messages.welcome", "../etc")).toBeNull();
  });
});

describe("resolveLaravelEnvTarget", () => {
  it("maps an env literal to its key", () => {
    expect(resolveLaravelEnvTarget("APP_ENV")).toEqual({
      relativeFilePath: ".env",
      key: "APP_ENV",
    });
  });

  it("trims surrounding whitespace from the key", () => {
    expect(resolveLaravelEnvTarget("  APP_ENV  ")).toEqual({
      relativeFilePath: ".env",
      key: "APP_ENV",
    });
  });

  it("allows a leading digit in the key", () => {
    expect(resolveLaravelEnvTarget("2FA_ENABLED")).toEqual({
      relativeFilePath: ".env",
      key: "2FA_ENABLED",
    });
  });

  it("returns null for the empty literal", () => {
    expect(resolveLaravelEnvTarget("")).toBeNull();
  });

  it("returns null for a whitespace-only literal", () => {
    expect(resolveLaravelEnvTarget("   ")).toBeNull();
  });

  it("returns null for a key with invalid characters", () => {
    expect(resolveLaravelEnvTarget("APP ENV")).toBeNull();
  });
});
