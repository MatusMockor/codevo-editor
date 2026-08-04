import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function collectFiles(rootDir, relativeDir, out) {
  const absoluteDir = path.join(rootDir, relativeDir);
  for (const entry of readdirSync(absoluteDir).sort()) {
    const relativePath = relativeDir === "" ? entry : `${relativeDir}/${entry}`;
    const absolutePath = path.join(rootDir, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      collectFiles(rootDir, relativePath, out);
      continue;
    }
    out.push(relativePath);
  }
}

export function computeFixtureHashes(rootDir) {
  const relativePaths = [];
  collectFiles(rootDir, "", relativePaths);
  const hashes = {};
  for (const relativePath of relativePaths) {
    const digest = createHash("sha256");
    digest.update(readFileSync(path.join(rootDir, relativePath)));
    hashes[relativePath] = digest.digest("hex");
  }
  return hashes;
}
