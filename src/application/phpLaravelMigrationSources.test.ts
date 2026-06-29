import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import {
  isPhpLaravelMigrationPath,
  loadPhpLaravelMigrationSources,
  phpLaravelMigrationsDirectory,
  phpLaravelMigrationSourcesSignature,
  type PhpLaravelMigrationSourceReader,
} from "./phpLaravelMigrationSources";

function fileEntry(path: string): FileEntry {
  return {
    kind: "file",
    name: path.split("/").pop() ?? path,
    path,
  };
}

function directoryEntry(path: string): FileEntry {
  return {
    kind: "directory",
    name: path.split("/").pop() ?? path,
    path,
  };
}

function reader(
  entries: Record<string, FileEntry[]>,
  files: Record<string, string>,
): PhpLaravelMigrationSourceReader {
  return {
    readDirectory: vi.fn(async (path: string) => {
      if (!(path in entries)) {
        throw new Error(`No such directory: ${path}`);
      }

      return entries[path];
    }),
    readTextFile: vi.fn(async (path: string) => {
      if (!(path in files)) {
        throw new Error(`No such file: ${path}`);
      }

      return files[path];
    }),
  };
}

describe("phpLaravelMigrationsDirectory", () => {
  it("resolves the database/migrations directory under the root", () => {
    expect(phpLaravelMigrationsDirectory("/workspace")).toBe(
      "/workspace/database/migrations",
    );
    expect(phpLaravelMigrationsDirectory("/workspace/")).toBe(
      "/workspace/database/migrations",
    );
  });
});

describe("isPhpLaravelMigrationPath", () => {
  it("matches any path inside the migrations directory", () => {
    expect(
      isPhpLaravelMigrationPath(
        "/workspace",
        "/workspace/database/migrations/2024_01_01_000000_create_users_table.php",
      ),
    ).toBe(true);
    expect(
      isPhpLaravelMigrationPath(
        "/workspace",
        "/workspace/database/migrations/tenant/2024_01_01_000000_create_users_table.php",
      ),
    ).toBe(true);
    expect(
      isPhpLaravelMigrationPath("/workspace", "/workspace/database/migrations"),
    ).toBe(true);
  });

  it("rejects paths outside the migrations directory or another root", () => {
    expect(
      isPhpLaravelMigrationPath("/workspace", "/workspace/app/Models/User.php"),
    ).toBe(false);
    expect(
      isPhpLaravelMigrationPath(
        "/workspace",
        "/workspace/database/seeders/DatabaseSeeder.php",
      ),
    ).toBe(false);
    expect(
      isPhpLaravelMigrationPath(
        "/workspace-a",
        "/workspace-b/database/migrations/2024_create.php",
      ),
    ).toBe(false);
  });
});

describe("loadPhpLaravelMigrationSources", () => {
  it("reads every PHP migration file and returns contents in a stable sorted order", async () => {
    const dir = "/workspace/database/migrations";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/2024_02_02_000000_create_posts_table.php`),
          fileEntry(`${dir}/2024_01_01_000000_create_users_table.php`),
        ],
      },
      {
        [`${dir}/2024_01_01_000000_create_users_table.php`]: "<?php // users",
        [`${dir}/2024_02_02_000000_create_posts_table.php`]: "<?php // posts",
      },
    );

    const sources = await loadPhpLaravelMigrationSources("/workspace", gateway);

    // Sorted by path so the order (and therefore the signature) is stable.
    expect(sources).toEqual(["<?php // users", "<?php // posts"]);
  });

  it("recurses into migration subdirectories", async () => {
    const dir = "/workspace/database/migrations";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/2024_01_01_000000_create_users_table.php`),
          directoryEntry(`${dir}/tenant`),
        ],
        [`${dir}/tenant`]: [
          fileEntry(`${dir}/tenant/2024_03_03_000000_create_tenants_table.php`),
        ],
      },
      {
        [`${dir}/2024_01_01_000000_create_users_table.php`]: "<?php // users",
        [`${dir}/tenant/2024_03_03_000000_create_tenants_table.php`]:
          "<?php // tenants",
      },
    );

    const sources = await loadPhpLaravelMigrationSources("/workspace", gateway);

    expect(sources).toEqual(["<?php // users", "<?php // tenants"]);
  });

  it("ignores non-PHP files", async () => {
    const dir = "/workspace/database/migrations";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/2024_01_01_000000_create_users_table.php`),
          fileEntry(`${dir}/.gitkeep`),
          fileEntry(`${dir}/notes.txt`),
        ],
      },
      {
        [`${dir}/2024_01_01_000000_create_users_table.php`]: "<?php // users",
      },
    );

    const sources = await loadPhpLaravelMigrationSources("/workspace", gateway);

    expect(sources).toEqual(["<?php // users"]);
  });

  it("is graceful when the migrations directory does not exist", async () => {
    const gateway = reader({}, {});

    const sources = await loadPhpLaravelMigrationSources("/workspace", gateway);

    expect(sources).toEqual([]);
    expect(gateway.readTextFile).not.toHaveBeenCalled();
  });

  it("skips an unreadable migration but keeps the others", async () => {
    const dir = "/workspace/database/migrations";
    const gateway = reader(
      {
        [dir]: [
          fileEntry(`${dir}/2024_01_01_000000_create_users_table.php`),
          fileEntry(`${dir}/2024_02_02_000000_broken.php`),
        ],
      },
      {
        [`${dir}/2024_01_01_000000_create_users_table.php`]: "<?php // users",
      },
    );

    const sources = await loadPhpLaravelMigrationSources("/workspace", gateway);

    expect(sources).toEqual(["<?php // users"]);
  });
});

describe("phpLaravelMigrationSourcesSignature", () => {
  it("is stable for the same content and changes when content changes", () => {
    const a = phpLaravelMigrationSourcesSignature(["<?php // a", "<?php // b"]);
    const same = phpLaravelMigrationSourcesSignature([
      "<?php // a",
      "<?php // b",
    ]);
    const changed = phpLaravelMigrationSourcesSignature([
      "<?php // a",
      "<?php // b2",
    ]);

    expect(a).toBe(same);
    expect(a).not.toBe(changed);
  });

  it("distinguishes a different number of migration files", () => {
    expect(phpLaravelMigrationSourcesSignature([])).not.toBe(
      phpLaravelMigrationSourcesSignature(["<?php"]),
    );
    // A boundary shift between two files must not collide with a single
    // concatenated file of the same bytes.
    expect(
      phpLaravelMigrationSourcesSignature(["ab", "c"]),
    ).not.toBe(phpLaravelMigrationSourcesSignature(["a", "bc"]));
  });
});
