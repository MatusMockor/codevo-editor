import {
  phpNetteDatabaseTypeKind,
  phpNetteDatabaseTypesFromSource,
  phpNetteRepositoryTraitClassNames,
  phpNetteSiblingDatabaseType,
  phpNetteTableNameFromRepositorySource,
  type PhpNetteDatabaseTypes,
} from "../domain/phpNetteDatabaseTypes";

export interface PhpNetteDatabaseTypeResolver {
  clear?(): void;
  resolveClassTypes(className: string): Promise<PhpNetteDatabaseTypes | null>;
  resolveTableType(
    carrierType: string,
    kind: "activeRow" | "selection",
    tableName: string,
  ): Promise<string | null>;
}

export interface PhpNetteDatabaseTypeResolverDependencies {
  cachePolicy?: "generation" | "revalidate";
  isActive(): boolean;
  readClassSource(path: string, className: string): Promise<string>;
  resolveClassSourcePaths(className: string): Promise<string[]>;
}

export function createPhpNetteDatabaseTypeResolver({
  cachePolicy = "revalidate",
  isActive,
  readClassSource,
  resolveClassSourcePaths,
}: PhpNetteDatabaseTypeResolverDependencies): PhpNetteDatabaseTypeResolver {
  interface CacheEntry {
    sourceSignature: string;
    types: Promise<PhpNetteDatabaseTypes | null>;
  }

  const cache = new Map<string, CacheEntry>();
  const tableTypeCache = new Map<string, Promise<string | null>>();

  const classExists = async (className: string): Promise<boolean> => {
    const paths = await resolveClassSourcePaths(className);
    return isActive() && paths.length > 0;
  };

  const resolveClassTypes = async (
    className: string,
  ): Promise<PhpNetteDatabaseTypes | null> => {
    if (!isActive()) {
      return null;
    }

    const normalizedClassName = className.trim().replace(/^\\+/, "");
    const cacheKey = normalizedClassName.toLowerCase();
    const generationCached = cache.get(cacheKey);

    if (cachePolicy === "generation" && generationCached) {
      const cachedTypes = await generationCached.types;
      return isActive() ? cachedTypes : null;
    }

    const sourceSignature = await classSourceSignature(normalizedClassName);

    if (!isActive()) {
      return null;
    }

    const cached = cache.get(cacheKey);

    if (cached?.sourceSignature === sourceSignature) {
      const cachedTypes = await cached.types;

      if (!cachedTypes || (await verifiedTypes(cachedTypes))) {
        return cachedTypes;
      }

      cache.delete(cacheKey);
    }

    const pending = resolveTypesUncached(normalizedClassName)
      .then((types) => {
        if (!types) {
          cache.delete(cacheKey);
        }

        return types;
      })
      .catch((error: unknown) => {
        cache.delete(cacheKey);
        throw error;
      });
    cache.set(cacheKey, { sourceSignature, types: pending });
    return pending;
  };

  const classSourceSignature = async (className: string): Promise<string> => {
    const paths = await resolveClassSourcePaths(className);
    const sources: string[] = [];

    for (const path of paths) {
      sources.push(`${path}\0${await readClassSource(path, className)}`);
    }

    return sources.join("\0");
  };

  const resolveTypesUncached = async (
    className: string,
  ): Promise<PhpNetteDatabaseTypes | null> => {
    const kind = phpNetteDatabaseTypeKind(className);

    if (!kind) {
      return null;
    }

    if (kind === "activeRow" || kind === "selection") {
      const activeRowType = phpNetteSiblingDatabaseType(className, "activeRow");
      const selectionType = phpNetteSiblingDatabaseType(className, "selection");

      if (!activeRowType || !selectionType) {
        return null;
      }

      if (
        !(await classExists(activeRowType)) ||
        !(await classExists(selectionType))
      ) {
        return null;
      }

      return { activeRowType, selectionType };
    }

    for (const path of await resolveClassSourcePaths(className)) {
      if (!isActive()) {
        return null;
      }

      const source = await readClassSource(path, className);

      if (!isActive()) {
        return null;
      }

      const directTypes = phpNetteDatabaseTypesFromSource(source, className);

      if (directTypes) {
        return verifiedTypes(directTypes);
      }

      for (const traitName of phpNetteRepositoryTraitClassNames(
        source,
        className,
      )) {
        const traitTypes = await resolveTypesFromTrait(traitName);

        if (traitTypes) {
          return traitTypes;
        }
      }

      const tableName = phpNetteTableNameFromRepositorySource(source);
      const traitName = phpNetteRepositoryTraitClassNames(source, className)[0];

      if (!tableName || !traitName) {
        continue;
      }

      const repositoryNamespace = traitName.replace(
        /\\Repository\\[^\\]+$/,
        "",
      );
      const activeRowType = `${repositoryNamespace}\\ActiveRow\\${phpNetteTypeStem(tableName)}ActiveRow`;
      const selectionType = `${repositoryNamespace}\\Selection\\${phpNetteTypeStem(tableName)}Selection`;
      const conventionalTypes = await verifiedTypes({
        activeRowType,
        selectionType,
      });

      if (conventionalTypes) {
        return conventionalTypes;
      }
    }

    return null;
  };

  const resolveTypesFromTrait = async (
    traitName: string,
  ): Promise<PhpNetteDatabaseTypes | null> => {
    for (const path of await resolveClassSourcePaths(traitName)) {
      if (!isActive()) {
        return null;
      }

      const source = await readClassSource(path, traitName);
      const types = phpNetteDatabaseTypesFromSource(source, traitName);

      if (types) {
        return verifiedTypes(types);
      }
    }

    return null;
  };

  const verifiedTypes = async (
    types: PhpNetteDatabaseTypes,
  ): Promise<PhpNetteDatabaseTypes | null> => {
    if (!(await classExists(types.activeRowType))) {
      return null;
    }

    return (await classExists(types.selectionType)) ? types : null;
  };

  return {
    clear() {
      cache.clear();
      tableTypeCache.clear();
    },
    resolveClassTypes,
    async resolveTableType(carrierType, kind, tableName) {
      if (!isActive()) {
        return null;
      }

      const cacheKey = `${carrierType.trim().toLowerCase()}\0${kind}\0${tableName.toLowerCase()}`;
      const cached = tableTypeCache.get(cacheKey);

      if (cachePolicy === "generation" && cached) {
        const cachedType = await cached;
        return isActive() ? cachedType : null;
      }

      const candidate = phpNetteSiblingDatabaseType(
        carrierType,
        kind,
        tableName,
      );
      const pending = candidate
        ? classExists(candidate).then((exists) => (exists ? candidate : null))
        : Promise.resolve(null);

      if (cachePolicy !== "generation") {
        return pending;
      }

      tableTypeCache.set(cacheKey, pending);

      try {
        const result = await pending;

        if (!result) {
          tableTypeCache.delete(cacheKey);
        }

        return result;
      } catch (error) {
        tableTypeCache.delete(cacheKey);
        throw error;
      }
    },
  };
}

function phpNetteTypeStem(tableName: string): string {
  return tableName
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join("");
}
