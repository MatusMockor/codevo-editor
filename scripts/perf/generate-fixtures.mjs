#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLargeFileFixtures } from "./fixtureGenerator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturesRoot = path.join(repoRoot, "perf", "fixtures");
fs.rmSync(fixturesRoot, { recursive: true, force: true });
fs.mkdirSync(fixturesRoot, { recursive: true });
writeLargeFileFixtures({ rootDir: fixturesRoot, fs });
console.log(`Fixtures written to ${fixturesRoot}`);
