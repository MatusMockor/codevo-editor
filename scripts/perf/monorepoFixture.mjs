import path from "node:path";
import { createSeededRandom, generateLargeTsFileContent } from "./fixtureGenerator.mjs";

export const MONOREPO_PACKAGE_COUNT = 50;
const EXTRA_FILES_PER_PACKAGE = 60;

function packageName(index) {
  return `pkg-${String(index).padStart(2, "0")}`;
}

function referenceIndexes(index) {
  if (index === 0) {
    return [];
  }
  if (index === 1) {
    return [0];
  }
  return [index - 1, Math.floor(index / 2)];
}

export function writeMonorepoFixture({ rootDir, fs }) {
  const root = path.join(rootDir, "monorepo");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@perf/monorepo", private: true, workspaces: ["packages/*"] }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        files: [],
        references: Array.from({ length: MONOREPO_PACKAGE_COUNT }, (_, i) => ({
          path: `./packages/${packageName(i)}`,
        })),
      },
      null,
      2,
    ),
  );
  for (let i = 0; i < MONOREPO_PACKAGE_COUNT; i += 1) {
    writePackage({ root, fs, index: i });
  }
}

function writePackage({ root, fs, index }) {
  const name = packageName(index);
  const dir = path.join(root, "packages", name);
  const srcDir = path.join(dir, "src");
  const extraDir = path.join(srcDir, "extra");
  fs.mkdirSync(extraDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: `@perf/${name}`, version: "1.0.0", main: "src/index.ts", types: "src/index.ts" },
      null,
      2,
    ),
  );
  const references = referenceIndexes(index).map((ref) => ({
    path: `../${packageName(ref)}`,
  }));
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          composite: true,
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          baseUrl: ".",
          paths: { "@perf/*": ["../*/src"] },
        },
        include: ["src"],
        references,
      },
      null,
      2,
    ),
  );
  const imports = referenceIndexes(index)
    .map((ref, i) => `import * as dep${i} from "@perf/${packageName(ref)}";`)
    .concat(referenceIndexes(index).map((_, i) => `void dep${i};`));
  const random = createSeededRandom(1000 + index);
  const moduleBody = generateLargeTsFileContent({ lines: 200, random });
  fs.writeFileSync(path.join(srcDir, "moduleA.ts"), [...imports, moduleBody].join("\n"));
  fs.writeFileSync(path.join(srcDir, "moduleB.ts"), moduleBody);
  fs.writeFileSync(
    path.join(srcDir, "index.ts"),
    ['export * from "./moduleA";', 'export * as moduleB from "./moduleB";', ""].join("\n"),
  );
  for (let f = 0; f < EXTRA_FILES_PER_PACKAGE; f += 1) {
    const extraRandom = createSeededRandom(index * 1000 + f);
    fs.writeFileSync(
      path.join(extraDir, `file-${String(f).padStart(3, "0")}.ts`),
      generateLargeTsFileContent({ lines: 40, random: extraRandom }),
    );
  }
}
