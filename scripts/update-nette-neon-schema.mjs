#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const snapshotPath = path.join(
  repoRoot,
  "src/assets/schemas/nette-neon-schema.json",
);
const argumentsList = process.argv.slice(2);
const checkOnly = argumentsList.includes("--check");
const vendorRootArgument = argumentsList.find(
  (argument) => argument !== "--check",
);

if (!vendorRootArgument) {
  throw new Error(
    "Usage: node scripts/update-nette-neon-schema.mjs [--check] /path/to/vendor",
  );
}

const vendorRoot = path.resolve(vendorRootArgument);
const sourceDefinitions = [
  ["nette/di", "src/DI/Extensions/DefinitionSchema.php"],
  ["nette/di", "src/DI/Extensions/SearchExtension.php"],
  ["nette/database", "src/Bridges/DatabaseDI/DatabaseExtension.php"],
  ["nette/mail", "src/Bridges/MailDI/MailExtension.php"],
  ["nette/security", "src/Bridges/SecurityDI/SecurityExtension.php"],
];
const nestedDefinitions = [
  [
    "database.*",
    "nette/database",
    "src/Bridges/DatabaseDI/DatabaseExtension.php",
    "getConfigSchema",
  ],
  [
    "mail.dkim",
    "nette/mail",
    "src/Bridges/MailDI/MailExtension.php",
    "'dkim' =>",
  ],
  [
    "search.*",
    "nette/di",
    "src/DI/Extensions/SearchExtension.php",
    "getConfigSchema",
  ],
  [
    "search.*.exclude",
    "nette/di",
    "src/DI/Extensions/SearchExtension.php",
    "'exclude' =>",
  ],
  [
    "security.authentication",
    "nette/security",
    "src/Bridges/SecurityDI/SecurityExtension.php",
    "'authentication' =>",
  ],
  [
    "security.users.*",
    "nette/security",
    "src/Bridges/SecurityDI/SecurityExtension.php",
    "'users' =>",
  ],
];

const previousSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const installedMetadata = await readInstalledPackages(vendorRoot);
const lockMetadata = await readLockPackages(path.dirname(vendorRoot));
const sourceContents = new Map();
const sources = [];

for (const [packageName, relativePath] of sourceDefinitions) {
  const metadata = installedMetadata.get(packageName);

  if (!metadata) {
    throw new Error(`Supported vendor tree is missing ${packageName}`);
  }

  const sourcePath = path.join(
    vendorRoot,
    ...packageName.split("/"),
    relativePath,
  );
  const content = await readFile(sourcePath, "utf8");
  sourceContents.set(`${packageName}/${relativePath}`, content);
  sources.push({
    package: packageName,
    version: normalizeVersion(metadata.version),
    revision: metadata.reference,
    path: relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}

const previousServiceSpecs = specsByName(
  previousSnapshot.serviceItemKeys ?? [],
);
const definitionSource = sourceContents.get(
  "nette/di/src/DI/Extensions/DefinitionSchema.php",
);

if (!definitionSource) {
  throw new Error("Missing loaded nette/di DefinitionSchema.php");
}

const serviceSchemaOffset = definitionSource.indexOf(
  "private static function getServiceSchema",
);

if (serviceSchemaOffset < 0) {
  throw new Error("Unable to locate getServiceSchema in nette/di");
}

const serviceKeyNames = directExpectKeys(
  definitionSource.slice(serviceSchemaOffset),
);

for (const legacyAlias of ["class", "factory"]) {
  if (!definitionSource.includes(`$def['${legacyAlias}']`)) {
    continue;
  }

  serviceKeyNames.push(legacyAlias);
}

const serviceItemKeys = uniqueSorted(serviceKeyNames).map((name) =>
  generatedSpec(
    name,
    previousServiceSpecs.get(name),
    "nette/di",
    packageVersion(installedMetadata, "nette/di"),
  ),
);
const nestedSectionKeys = {};

for (const [
  sectionPath,
  packageName,
  relativePath,
  marker,
] of nestedDefinitions) {
  const source = sourceContents.get(`${packageName}/${relativePath}`);

  if (!source) {
    throw new Error(`Missing loaded source ${packageName}/${relativePath}`);
  }

  const previousSpecs = specsByName(
    previousSnapshot.nestedSectionKeys?.[sectionPath] ?? [],
  );
  nestedSectionKeys[sectionPath] = directStructureKeys(source, marker).map(
    (name) =>
      generatedSpec(
        name,
        previousSpecs.get(name),
        packageName,
        packageVersion(installedMetadata, packageName),
      ),
  );
}

const sourceTimes = sourceDefinitions
  .map(([packageName]) => lockMetadata.get(packageName)?.time)
  .filter((value) => typeof value === "string")
  .sort();
const generatedAt = sourceTimes.at(-1)?.slice(0, 10) ?? "unknown";
const snapshot = {
  schemaVersion: 2,
  generatedAt,
  sources,
  serviceItemKeys,
  nestedSectionKeys,
};
const normalizedSnapshot = `${JSON.stringify(snapshot, null, 2)}\n`;
const currentSnapshot = await readFile(snapshotPath, "utf8");

if (checkOnly && currentSnapshot !== normalizedSnapshot) {
  throw new Error(
    `${snapshotPath} differs from the supported vendor tree; run the updater without --check`,
  );
}

if (!checkOnly && currentSnapshot !== normalizedSnapshot) {
  await writeFile(snapshotPath, normalizedSnapshot);
}

console.log(
  `${checkOnly ? "Verified" : "Generated"} offline NEON schema ${snapshotPath}`,
);

async function readInstalledPackages(root) {
  const installed = JSON.parse(
    await readFile(path.join(root, "composer/installed.json"), "utf8"),
  );
  const packages = Array.isArray(installed) ? installed : installed.packages;

  if (!Array.isArray(packages)) {
    throw new Error("vendor/composer/installed.json has no packages array");
  }

  return new Map(
    packages.map((entry) => [
      entry.name,
      {
        reference:
          entry.source?.reference ?? entry.dist?.reference ?? "unknown",
        version: entry.version,
      },
    ]),
  );
}

async function readLockPackages(projectRoot) {
  let lock;

  try {
    lock = JSON.parse(
      await readFile(path.join(projectRoot, "composer.lock"), "utf8"),
    );
  } catch {
    return new Map();
  }

  const packages = [...(lock.packages ?? []), ...(lock["packages-dev"] ?? [])];
  return new Map(packages.map((entry) => [entry.name, entry]));
}

function packageVersion(packages, packageName) {
  const metadata = packages.get(packageName);

  if (!metadata) {
    throw new Error(`Missing installed metadata for ${packageName}`);
  }

  return normalizeVersion(metadata.version);
}

function normalizeVersion(version) {
  if (typeof version !== "string") {
    throw new Error("Composer package version is missing");
  }

  return version.replace(/^v/, "");
}

function specsByName(specs) {
  return new Map(specs.map((spec) => [spec.name, spec]));
}

function generatedSpec(name, previous, packageName, installedVersion) {
  if (previous) {
    return {
      name,
      valueKind: previous.valueKind,
      description: previous.description,
      ...(previous.compatibility
        ? { compatibility: previous.compatibility }
        : {}),
    };
  }

  return {
    name,
    valueKind: "scalar",
    description: `Nette configuration key ${name}`,
    compatibility: {
      package: packageName,
      minVersion: installedVersion,
    },
  };
}

function directExpectKeys(source) {
  return [...source.matchAll(/^\s*'([^']+)'\s*=>\s*Expect::/gm)].map(
    (match) => match[1],
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function directStructureKeys(source, marker) {
  const markerOffset = source.indexOf(marker);
  const structureOffset = source.indexOf("Expect::structure([", markerOffset);

  if (markerOffset < 0 || structureOffset < 0) {
    throw new Error(`Unable to locate pinned schema structure after ${marker}`);
  }

  const openBracket = source.indexOf("[", structureOffset);
  const keys = [];
  let depth = 1;
  let index = openBracket + 1;

  while (index < source.length && depth > 0) {
    if (source.startsWith("//", index)) {
      const lineEnd = source.indexOf("\n", index + 2);
      index = lineEnd < 0 ? source.length : lineEnd;
      continue;
    }

    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);
      index = commentEnd < 0 ? source.length : commentEnd + 2;
      continue;
    }

    const character = source[index];

    if (character === "[") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === "]") {
      depth -= 1;
      index += 1;
      continue;
    }

    if (character !== "'" && character !== '"') {
      index += 1;
      continue;
    }

    const quote = character;
    const valueStart = index + 1;
    index += 1;

    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }

      if (source[index] === quote) {
        break;
      }

      index += 1;
    }

    const value = source.slice(valueStart, index);
    index += 1;
    let lookahead = index;

    while (/\s/.test(source[lookahead] ?? "")) {
      lookahead += 1;
    }

    if (depth === 1 && source.startsWith("=>", lookahead)) {
      keys.push(value);
    }
  }

  if (depth !== 0) {
    throw new Error(`Unterminated pinned schema structure after ${marker}`);
  }

  return keys;
}
