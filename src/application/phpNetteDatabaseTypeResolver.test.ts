import { describe, expect, it, vi } from "vitest";
import { createPhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

const TYPES = {
  activeRowType: "Generated\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
  selectionType: "Generated\\ActiveRowTypes\\Selection\\UsersSelection",
};

describe("phpNetteDatabaseTypeResolver", () => {
  it("resolves generated repository types and revalidates cached source", async () => {
    const sources: Record<string, string> = {
      "App\\UsersRepository": `<?php
use Generated\\ActiveRowTypes\\ActiveRow\\UsersActiveRow;
use Generated\\ActiveRowTypes\\Repository\\UsersRepositoryTrait;
use Generated\\ActiveRowTypes\\Selection\\UsersSelection;
class UsersRepository { use UsersRepositoryTrait; protected string $tableName = 'users'; }
`,
      [TYPES.activeRowType]: "<?php abstract class UsersActiveRow {}",
      [TYPES.selectionType]: "<?php abstract class UsersSelection {}",
    };
    const resolveClassSourcePaths = vi.fn(async (className: string) =>
      sources[className] ? [`/${className}.php`] : [],
    );
    const resolver = createPhpNetteDatabaseTypeResolver({
      isActive: () => true,
      readClassSource: async (_path, className) => sources[className] ?? "",
      resolveClassSourcePaths,
    });

    await expect(resolver.resolveClassTypes("App\\UsersRepository")).resolves.toEqual(
      TYPES,
    );
    await expect(resolver.resolveClassTypes("App\\UsersRepository")).resolves.toEqual(
      TYPES,
    );
    expect(resolveClassSourcePaths).toHaveBeenCalledWith("App\\UsersRepository");
    expect(resolveClassSourcePaths).toHaveBeenCalledWith("App\\UsersRepository");
  });

  it("rejects missing generated classes and inactive workspace owners", async () => {
    let active = true;
    const resolver = createPhpNetteDatabaseTypeResolver({
      isActive: () => active,
      readClassSource: async () => `<?php
use Generated\\ActiveRowTypes\\ActiveRow\\UsersActiveRow;
use Generated\\ActiveRowTypes\\Selection\\UsersSelection;
class UsersRepository {}`,
      resolveClassSourcePaths: async (className) =>
        className === "App\\UsersRepository" ? ["/repo.php"] : [],
    });

    await expect(resolver.resolveClassTypes("App\\UsersRepository")).resolves.toBeNull();
    active = false;
    await expect(resolver.resolveClassTypes("App\\UsersRepository")).resolves.toBeNull();
  });

  it("resolves literal relation targets only when the generated type exists", async () => {
    const target = "Generated\\ActiveRowTypes\\ActiveRow\\UserStatusesActiveRow";
    const resolver = createPhpNetteDatabaseTypeResolver({
      isActive: () => true,
      readClassSource: async () => "",
      resolveClassSourcePaths: async (className) =>
        className === target ? ["/status.php"] : [],
    });

    await expect(
      resolver.resolveTableType(
        "Generated\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
        "activeRow",
        "user_statuses",
      ),
    ).resolves.toBe(target);
    await expect(
      resolver.resolveTableType(
        "Generated\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
        "selection",
        "unknown_table",
      ),
    ).resolves.toBeNull();
  });

  it("keeps caches isolated per project runtime and retries negative discoveries", async () => {
    const className = "App\\UsersRepository";
    const firstTypes = {
      activeRowType: "First\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
      selectionType: "First\\ActiveRowTypes\\Selection\\UsersSelection",
    };
    const secondTypes = {
      activeRowType: "Second\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
      selectionType: "Second\\ActiveRowTypes\\Selection\\UsersSelection",
    };
    let firstGeneratedTypesExist = false;
    const createResolver = (
      types: typeof firstTypes,
      generatedTypesExist: () => boolean,
    ) =>
      createPhpNetteDatabaseTypeResolver({
        isActive: () => true,
        readClassSource: async () => `<?php
use ${types.activeRowType};
use ${types.selectionType};
class UsersRepository {}`,
        resolveClassSourcePaths: async (candidate) => {
          if (candidate === className) {
            return ["/repository.php"];
          }

          return generatedTypesExist() && Object.values(types).includes(candidate)
            ? [`/${candidate}.php`]
            : [];
        },
      });
    const first = createResolver(firstTypes, () => firstGeneratedTypesExist);
    const second = createResolver(secondTypes, () => true);

    await expect(first.resolveClassTypes(className)).resolves.toBeNull();
    await expect(second.resolveClassTypes(className)).resolves.toEqual(secondTypes);
    firstGeneratedTypesExist = true;
    await expect(first.resolveClassTypes(className)).resolves.toEqual(firstTypes);
  });

  it("evicts a rejected discovery so a transient read failure can retry", async () => {
    let readAttempts = 0;
    const source = `<?php
use Generated\\ActiveRowTypes\\Repository\\UsersRepositoryTrait;
class UsersRepository { use UsersRepositoryTrait; }`;
    const resolver = createPhpNetteDatabaseTypeResolver({
      isActive: () => true,
      readClassSource: async (_path, className) => {
        if (className === "App\\UsersRepository" && readAttempts++ === 1) {
          throw new Error("transient read failure");
        }

        return source;
      },
      resolveClassSourcePaths: async (className) =>
        className === "App\\UsersRepository" || Object.values(TYPES).includes(className)
          ? [`/${className}.php`]
          : [],
    });

    await expect(
      resolver.resolveClassTypes("App\\UsersRepository"),
    ).rejects.toThrow("transient read failure");
    await expect(
      resolver.resolveClassTypes("App\\UsersRepository"),
    ).resolves.toEqual(TYPES);
  });

  it("invalidates a successful discovery when its repository source changes", async () => {
    const profileTypes = {
      activeRowType: "Generated\\ActiveRowTypes\\ActiveRow\\ProfilesActiveRow",
      selectionType: "Generated\\ActiveRowTypes\\Selection\\ProfilesSelection",
    };
    let source = `<?php
use Generated\\ActiveRowTypes\\Repository\\UsersRepositoryTrait;
class Repository { use UsersRepositoryTrait; }`;
    const resolver = createPhpNetteDatabaseTypeResolver({
      isActive: () => true,
      readClassSource: async () => source,
      resolveClassSourcePaths: async (className) =>
        className === "App\\Repository" ||
        [...Object.values(TYPES), ...Object.values(profileTypes)].includes(className)
          ? [`/${className}.php`]
          : [],
    });

    await expect(resolver.resolveClassTypes("App\\Repository")).resolves.toEqual(
      TYPES,
    );

    source = `<?php
use Generated\\ActiveRowTypes\\Repository\\ProfilesRepositoryTrait;
class Repository { use ProfilesRepositoryTrait; }`;

    await expect(resolver.resolveClassTypes("App\\Repository")).resolves.toEqual(
      profileTypes,
    );
  });
});
