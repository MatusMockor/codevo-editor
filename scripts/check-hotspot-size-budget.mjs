import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([".rs", ".ts", ".tsx"]);

export function countSourceLines(content) {
  if (content.length === 0) return 0;
  const lines = content.split(/\r?\n/).length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

/** Whitespace/comment-invariant lexical complexity proxy. */
export function countStructuralTokens(content, sourcePath = "") {
  let count = 0;
  let index = 0;
  const rustSource = path.extname(sourcePath) === ".rs";

  while (index < content.length) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && next === "/") {
      index = skipLineComment(content, index + 2);
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(content, index + 2);
      continue;
    }
    if (character === "`") {
      const template = templateToken(content, index, sourcePath);
      count += template.tokens;
      index = template.end;
      continue;
    }
    if (rustSource && character === "'") {
      const characterEnd = rustCharacterLiteralEnd(content, index);
      if (characterEnd !== null) {
        count += 1;
        index = characterEnd;
        continue;
      }
      const lifetimeEnd = rustLifetimeEnd(content, index);
      if (lifetimeEnd !== null) {
        count += 1;
        index = lifetimeEnd;
        continue;
      }
    }
    if (character === '"' || character === "'") {
      const end = quotedTokenEnd(content, index, character);
      if (end !== null) {
        count += 1;
        index = end;
        continue;
      }
    }
    if (/[A-Za-z_$\u0080-\uFFFF]/u.test(character)) {
      index += 1;
      while (index < content.length && /[A-Za-z0-9_$\u0080-\uFFFF]/u.test(content[index] ?? "")) {
        index += 1;
      }
      count += 1;
      continue;
    }
    if (/[0-9]/u.test(character)) {
      index += 1;
      while (index < content.length && /[A-Za-z0-9_.]/u.test(content[index] ?? "")) {
        index += 1;
      }
      count += 1;
      continue;
    }
    if (character === "," && /[\])}]/u.test(nextCodeCharacter(content, index + 1))) {
      index += 1;
      continue;
    }
    if (character === ";") {
      index += 1;
      continue;
    }
    count += 1;
    index += 1;
  }

  return count;
}

export function evaluateHotspotSizes(baseline, currentFiles, productionFiles) {
  const growth = [];
  const reductions = [];
  const oversizedUntracked = [];

  for (const [filePath, expected] of Object.entries(baseline.files)) {
    const actual = currentFiles[filePath]?.structuralTokens ?? 0;
    if (actual > expected.structuralTokens) {
      growth.push({ actual, expected: expected.structuralTokens, path: filePath });
    }
    if (actual < expected.structuralTokens) {
      reductions.push({ actual, expected: expected.structuralTokens, path: filePath });
    }
  }

  for (const filePath of [...productionFiles].sort()) {
    const actual = currentFiles[filePath];
    if (
      actual &&
      baseline.files[filePath] === undefined &&
      (actual.rawLines > baseline.productionLineLimit ||
        actual.structuralTokens > baseline.productionStructuralTokenLimit)
    ) {
      oversizedUntracked.push({
        path: filePath,
        rawLines: actual.rawLines,
        rawLineLimit: baseline.productionLineLimit,
        structuralTokens: actual.structuralTokens,
        structuralTokenLimit: baseline.productionStructuralTokenLimit,
      });
    }
  }

  return { growth, oversizedUntracked, reductions };
}

export function reducedBaselineUpdate(baseline, currentFiles, productionFiles) {
  const evaluation = evaluateHotspotSizes(baseline, currentFiles, productionFiles);
  const violations = [
    ...evaluation.growth.map((entry) => ({ ...entry, kind: "growth" })),
    ...evaluation.oversizedUntracked.map((entry) => ({
      ...entry,
      kind: "oversized-untracked",
    })),
  ];
  const files = {};

  for (const [filePath, expected] of Object.entries(baseline.files)) {
    const actual = currentFiles[filePath];
    if (!actual) continue;
    files[filePath] = {
      rawLines: Math.min(expected.rawLines, actual.rawLines),
      structuralTokens: Math.min(expected.structuralTokens, actual.structuralTokens),
    };
  }

  return { baseline: { ...baseline, files }, violations };
}

export function isProductionSource(filePath) {
  if (filePath.startsWith("src-tauri/src/") && filePath.endsWith(".rs")) return true;
  return (
    filePath.startsWith("src/") &&
    (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) &&
    !filePath.includes(".test.") &&
    !filePath.startsWith("src/test/")
  );
}

async function collectSourceFiles(projectRoot) {
  const relativePaths = [
    ...(await walk(path.join(projectRoot, "src"), projectRoot)),
    ...(await walk(path.join(projectRoot, "src-tauri/src"), projectRoot)),
  ];
  const currentFiles = {};
  for (const relativePath of relativePaths.sort()) {
    const content = await readFile(path.join(projectRoot, relativePath), "utf8");
    currentFiles[relativePath] = {
      rawLines: countSourceLines(content),
      structuralTokens: countStructuralTokens(content, relativePath),
    };
  }
  return currentFiles;
}

async function walk(directory, projectRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(absolutePath, projectRoot)));
    } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.relative(projectRoot, absolutePath).split(path.sep).join("/"));
    }
  }
  return files;
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDirectory, "..");
  const baselinePath = path.join(scriptDirectory, "hotspot-size-baseline.json");
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const currentFiles = await collectSourceFiles(projectRoot);
  const productionFiles = new Set(Object.keys(currentFiles).filter(isProductionSource));

  if (process.argv.includes("--update")) {
    const update = reducedBaselineUpdate(baseline, currentFiles, productionFiles);
    if (update.violations.length > 0) {
      console.error(
        "Refusing to update: growth and new oversized files require manual baseline review.",
      );
      for (const violation of update.violations) {
        console.error(`  ${violation.path}: ${violation.kind}`);
      }
      process.exit(1);
    }
    await writeFile(baselinePath, `${JSON.stringify(update.baseline, null, 2)}\n`);
    console.log(
      `Lowered hotspot baseline for ${Object.keys(update.baseline.files).length} file(s).`,
    );
    return;
  }

  const result = evaluateHotspotSizes(baseline, currentFiles, productionFiles);
  console.log(
    `Hotspot baseline: ${Object.keys(baseline.files).length} tracked file(s), ` +
      `${baseline.productionLineLimit} raw lines / ` +
      `${baseline.productionStructuralTokenLimit} structural tokens for new production files`,
  );
  reportResult(result);
  if (
    result.growth.length > 0 ||
    result.oversizedUntracked.length > 0 ||
    result.reductions.length > 0
  ) {
    process.exit(1);
  }
}

function reportResult(result) {
  if (result.growth.length > 0) {
    console.error("Tracked hotspot structural size increased:");
    for (const entry of result.growth) {
      console.error(`  ${entry.path}: ${entry.actual}/${entry.expected}`);
    }
  }
  if (result.oversizedUntracked.length > 0) {
    console.error("Untracked production files exceed a size limit:");
    for (const entry of result.oversizedUntracked) {
      console.error(
        `  ${entry.path}: ${entry.rawLines}/${entry.rawLineLimit} raw lines, ` +
          `${entry.structuralTokens}/${entry.structuralTokenLimit} structural tokens`,
      );
    }
  }
  if (result.reductions.length > 0) {
    console.error("Structural size decreased; lock it in with:");
    console.error("  npm run size:hotspots:update");
    for (const entry of result.reductions) {
      console.error(`  ${entry.path}: ${entry.expected} -> ${entry.actual}`);
    }
  }
}

function skipLineComment(content, index) {
  const newline = content.indexOf("\n", index);
  return newline < 0 ? content.length : newline + 1;
}

function skipBlockComment(content, index) {
  const close = content.indexOf("*/", index);
  return close < 0 ? content.length : close + 2;
}

function quotedTokenEnd(content, start, quote) {
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index] ?? "";
    if (character === "\\") {
      index += 1;
    } else if (character === quote) {
      return index + 1;
    } else if (quote === "'" && (character === "\n" || character === "\r")) {
      return null;
    }
  }
  return quote === "`" ? content.length : null;
}

function templateToken(content, start, sourcePath) {
  let expressionTokens = 0;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "`") {
      return { end: index + 1, tokens: 1 + expressionTokens };
    }
    if (character === "$" && next === "{") {
      const expressionEnd = templateExpressionEnd(content, index + 2);
      if (expressionEnd === null) {
        return { end: content.length, tokens: 1 + expressionTokens };
      }
      expressionTokens += countStructuralTokens(
        content.slice(index + 2, expressionEnd),
        sourcePath,
      );
      index = expressionEnd;
    }
  }
  return { end: content.length, tokens: 1 + expressionTokens };
}

function templateExpressionEnd(content, from) {
  let braceDepth = 0;
  for (let index = from; index < content.length; index += 1) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (character === "/" && next === "/") {
      index = skipLineComment(content, index + 2) - 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(content, index + 2) - 1;
      continue;
    }
    if (character === "/" && canStartRegexLiteral(content, index, from)) {
      const regexEnd = regexLiteralEnd(content, index);
      if (regexEnd !== null) {
        index = regexEnd - 1;
        continue;
      }
    }
    if (character === '"' || character === "'") {
      const quotedEnd = quotedTokenEnd(content, index, character);
      if (quotedEnd !== null) {
        index = quotedEnd - 1;
        continue;
      }
    }
    if (character === "`") {
      index = templateToken(content, index, "").end - 1;
      continue;
    }
    if (character === "{") {
      braceDepth += 1;
      continue;
    }
    if (character === "}" && braceDepth === 0) return index;
    if (character === "}") braceDepth -= 1;
  }
  return null;
}

function canStartRegexLiteral(content, start, expressionStart) {
  let index = start - 1;
  while (index >= expressionStart && /\s/u.test(content[index] ?? "")) index -= 1;
  if (index < expressionStart) return true;
  return "([{,:;=!?&|+-*%^~<>".includes(content[index] ?? "");
}

function regexLiteralEnd(content, start) {
  let inCharacterClass = false;
  for (let index = start + 1; index < content.length; index += 1) {
    const character = content[index] ?? "";
    if (character === "\n" || character === "\r") return null;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") {
      inCharacterClass = true;
      continue;
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (character === "/" && !inCharacterClass) {
      index += 1;
      while (/[A-Za-z]/u.test(content[index] ?? "")) index += 1;
      return index;
    }
  }
  return null;
}

function rustLifetimeEnd(content, start) {
  const first = content[start + 1] ?? "";
  if (!/[A-Za-z_]/u.test(first)) return null;
  let index = start + 2;
  while (/[A-Za-z0-9_]/u.test(content[index] ?? "")) index += 1;
  return index;
}

function rustCharacterLiteralEnd(content, start) {
  let index = start + 1;
  const first = content[index] ?? "";
  if (!first || first === "\n" || first === "\r" || first === "'") return null;

  if (first === "\\") {
    index += 1;
    if (content[index] === "u" && content[index + 1] === "{") {
      const close = content.indexOf("}", index + 2);
      if (close < 0 || !/^[0-9a-fA-F_]+$/u.test(content.slice(index + 2, close))) return null;
      index = close + 1;
    } else if (content[index] === "x") {
      if (!/^[0-9a-fA-F]{2}$/u.test(content.slice(index + 1, index + 3))) return null;
      index += 3;
    } else {
      if (!content[index] || content[index] === "\n" || content[index] === "\r") return null;
      index += 1;
    }
  } else {
    const codePoint = content.codePointAt(index);
    if (codePoint === undefined) return null;
    index += codePoint > 0xffff ? 2 : 1;
  }

  return content[index] === "'" ? index + 1 : null;
}

function nextCodeCharacter(content, from) {
  let index = from;
  while (index < content.length) {
    const character = content[index] ?? "";
    const next = content[index + 1] ?? "";
    if (/\s/u.test(character)) {
      index += 1;
    } else if (character === "/" && next === "/") {
      index = skipLineComment(content, index + 2);
    } else if (character === "/" && next === "*") {
      index = skipBlockComment(content, index + 2);
    } else {
      return character;
    }
  }
  return "";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
