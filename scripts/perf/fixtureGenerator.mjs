import path from "node:path";

export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

const TYPE_NAMES = ["User", "Order", "Invoice", "Widget", "Session", "Report", "Task", "Event"];

function interfaceBlock(random, index) {
  const name = `${pick(random, TYPE_NAMES)}Model${index}`;
  const fields = Array.from(
    { length: 3 + Math.floor(random() * 5) },
    (_, i) =>
      `  readonly field${i}: ${pick(random, ["string", "number", "boolean", `${name}Kind`])};`,
  );
  return [
    `export type ${name}Kind = ${['"a"', '"b"', '"c"'].join(" | ")};`,
    `export interface ${name} {`,
    ...fields,
    `}`,
  ];
}

function functionBlock(random, index) {
  const name = `process${pick(random, TYPE_NAMES)}${index}`;
  return [
    `export function ${name}(input: { id: number; label: string }): string {`,
    `  if (input.id < 0) {`,
    `    return "invalid";`,
    `  }`,
    `  const parts = [input.label, String(input.id)];`,
    `  return parts.join("-");`,
    `}`,
  ];
}

function typeAliasBlock(random, index) {
  const name = `${pick(random, TYPE_NAMES)}Union${index}`;
  const members = Array.from({ length: 4 + Math.floor(random() * 8) }, (_, i) => `"variant${i}"`);
  return [`export type ${name} = ${members.join(" | ")};`];
}

const BLOCK_BUILDERS = [interfaceBlock, functionBlock, typeAliasBlock];

export function generateLargeTsFileContent({ lines, random }) {
  const out = [];
  if (lines > 1) {
    out.push(`import { strict as assert } from "node:assert";`);
  }
  if (lines > 2) {
    out.push(`void assert;`);
  }
  let index = 0;
  while (out.length < lines - 1) {
    const block = pick(random, BLOCK_BUILDERS)(random, index);
    if (out.length + block.length + 1 > lines - 1) {
      break;
    }
    out.push(...block, "");
    index += 1;
  }
  while (out.length < lines - 1) {
    out.push(`export const pad${index} = ${index};`);
    index += 1;
  }
  return out.concat([""]).join("\n");
}

export function generateMinifiedTsFileContent({ statements, random }) {
  const parts = Array.from(
    { length: statements },
    (_, i) => `export const v${i}=${Math.floor(random() * 1000)};`,
  );
  return parts.join("");
}

export function generateHugeUnionTsFileContent({ members }) {
  const values = Array.from({ length: members }, (_, i) => `"member_${i}"`);
  return [
    `export type HugeUnion =`,
    `  | ${values.join("\n  | ")};`,
    `export function isHugeUnion(value: string): value is HugeUnion {`,
    `  return value.startsWith("member_");`,
    `}`,
    ``,
  ].join("\n");
}

export const LARGE_FILE_SPECS = [
  { name: "large-5k.ts", lines: 5000, seed: 5 },
  { name: "large-20k.ts", lines: 20000, seed: 20 },
  { name: "large-100k.ts", lines: 100000, seed: 100 },
];

export function writeLargeFileFixtures({ rootDir, fs }) {
  const dir = path.join(rootDir, "large-files");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@perf/large-files", private: true }, null, 2),
  );
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["*.ts"] }, null, 2),
  );
  for (const spec of LARGE_FILE_SPECS) {
    fs.writeFileSync(
      path.join(dir, spec.name),
      generateLargeTsFileContent({ lines: spec.lines, random: createSeededRandom(spec.seed) }),
    );
  }
  fs.writeFileSync(
    path.join(dir, "minified.ts"),
    generateMinifiedTsFileContent({ statements: 20000, random: createSeededRandom(9) }),
  );
  fs.writeFileSync(
    path.join(dir, "huge-union.ts"),
    generateHugeUnionTsFileContent({ members: 2000 }),
  );
}
