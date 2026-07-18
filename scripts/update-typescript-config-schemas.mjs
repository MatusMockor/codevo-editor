import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaDirectory = resolve(repositoryRoot, "src/assets/schemas");
const provenancePath = resolve(
  schemaDirectory,
  "typescript-config-schemas.provenance.json",
);
const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
const checkOnly = process.argv.slice(2).includes("--check");
const unsupportedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--check");

if (unsupportedArguments.length > 0) {
  throw new Error(`Unsupported arguments: ${unsupportedArguments.join(", ")}`);
}

if (!/^[0-9a-f]{40}$/.test(provenance.revision)) {
  throw new Error("SchemaStore provenance must pin a full 40-character Git revision.");
}

const license = await downloadPinnedFile(provenance.license.source);
verifyChecksum(provenance.license.source, license, provenance.license.sha256);

for (const schema of provenance.schemas) {
  if (basename(schema.target) !== schema.target || !schema.target.endsWith(".schema.json")) {
    throw new Error(`Unsafe schema target: ${schema.target}`);
  }
  const content = await downloadPinnedFile(schema.source);
  verifyChecksum(schema.source, content, schema.sha256);
  assertNoRemoteRefs(schema.source, JSON.parse(content.toString("utf8")));
  const target = resolve(schemaDirectory, schema.target);

  if (checkOnly) {
    const current = await readFile(target);
    if (!current.equals(content)) {
      throw new Error(`${schema.target} differs from pinned SchemaStore revision.`);
    }
    console.log(`Verified ${schema.target} at ${provenance.revision}.`);
    continue;
  }

  await writeFile(target, content);
  console.log(`Updated ${schema.target} from ${provenance.revision}.`);
}

async function downloadPinnedFile(source) {
  const url = `${provenance.repository}/raw/${provenance.revision}/${source}`;
  const response = await fetch(url, { redirect: "follow" });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function verifyChecksum(source, content, expected) {
  const digest = createHash("sha256").update(content).digest("hex");
  if (digest !== expected) {
    throw new Error(
      `Checksum mismatch for ${source}: expected ${expected}, received ${digest}.`,
    );
  }
}

function assertNoRemoteRefs(source, value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => assertNoRemoteRefs(source, entry));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string" && /^(?:https?:)?\/\//.test(entry)) {
      throw new Error(`${source} contains remote $ref ${entry}.`);
    }
    assertNoRemoteRefs(source, entry);
  }
}
