import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const INITIAL_ASSET_LIMIT_BYTES = 500 * 1024;

export async function inspectBundleBudget(distDirectory) {
  const indexPath = join(distDirectory, "index.html");
  const indexHtml = await readFile(indexPath, "utf8");
  const entryMatches = Array.from(
    indexHtml.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["']/g),
    (match) => match[1],
  );
  const modulePreloadMatches = Array.from(indexHtml.matchAll(/<link\b[^>]*>/g), (match) => match[0])
    .filter((tag) => /\brel=["']modulepreload["']/.test(tag))
    .flatMap((tag) => {
      const href = tag.match(/\bhref=["']([^"']+)["']/)?.[1];
      return href ? [href] : [];
    });
  const initialAssets = new Set();
  const dynamicImportsScanned = new Set();
  const visit = async (resolvedPath, dynamicImportScope = "all") => {
    const relativePath = relative(distDirectory, resolvedPath);
    const alreadyInitial = initialAssets.has(relativePath);
    initialAssets.add(relativePath);
    const shouldScanDynamicImports =
      dynamicImportScope !== "none" && !dynamicImportsScanned.has(relativePath);
    if (alreadyInitial && !shouldScanDynamicImports) return;
    const source = await readFile(resolvedPath, "utf8");
    if (!alreadyInitial) {
      const imports = Array.from(
        source.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g),
        (match) => match[1],
      );
      await Promise.all(
        imports.map((importPath) => visit(resolve(dirname(resolvedPath), importPath), "all")),
      );
    }
    if (shouldScanDynamicImports) {
      dynamicImportsScanned.add(relativePath);
      const paintMarkIndex = source.indexOf("codevo-startup-shell-painted");
      const eagerSource =
        dynamicImportScope === "before-paint-mark" && paintMarkIndex >= 0
          ? source.slice(0, paintMarkIndex)
          : source;
      const eagerDynamicImports = Array.from(
        eagerSource.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g),
        (match) => match[1],
      );
      await Promise.all(
        eagerDynamicImports.map((importPath) =>
          visit(resolve(dirname(resolvedPath), importPath), "all"),
        ),
      );
    }
  };
  await Promise.all(
    entryMatches.map((entryPath) =>
      visit(resolve(dirname(indexPath), entryPath), "before-paint-mark"),
    ),
  );
  await Promise.all(
    modulePreloadMatches.map((assetPath) => visit(resolve(dirname(indexPath), assetPath), "all")),
  );

  const assetsDirectory = join(distDirectory, "assets");
  const assetNames = await readdir(assetsDirectory);
  const assets = await Promise.all(
    assetNames.map(async (name) => ({
      bytes: (await stat(join(assetsDirectory, name))).size,
      initial: initialAssets.has(join("assets", name)),
      name,
    })),
  );
  return assets.filter(({ name }) => name.endsWith(".js"));
}

export function formatBundleBudgetReport(assets) {
  const oversizedInitial = assets.filter(
    ({ bytes, initial }) => initial && bytes > INITIAL_ASSET_LIMIT_BYTES,
  );
  const oversizedOnDemand = assets.filter(
    ({ bytes, initial }) => !initial && bytes > INITIAL_ASSET_LIMIT_BYTES,
  );
  const initialBytes = assets.reduce(
    (total, { bytes, initial }) => total + (initial ? bytes : 0),
    0,
  );
  const lines = [
    `Initial pre-paint JavaScript closure: ${(initialBytes / 1024).toFixed(2)} KiB across ${assets.filter(({ initial }) => initial).length} assets`,
    `On-demand JavaScript assets over 500 KiB: ${oversizedOnDemand.length}`,
    ...oversizedOnDemand.map(({ bytes, name }) => `  ${name}: ${(bytes / 1024).toFixed(2)} KiB`),
  ];
  return {
    initialBudgetExceeded: initialBytes > INITIAL_ASSET_LIMIT_BYTES,
    initialBytes,
    lines,
    oversizedInitial,
  };
}

async function main() {
  const distDirectory = resolve(process.cwd(), "dist");
  const report = formatBundleBudgetReport(await inspectBundleBudget(distDirectory));
  process.stdout.write(`${report.lines.join("\n")}\n`);
  if (report.initialBudgetExceeded) {
    process.stderr.write(
      `Initial pre-paint JavaScript closure exceeds 500 KiB: ${(report.initialBytes / 1024).toFixed(2)} KiB\n`,
    );
    for (const { bytes, name } of report.oversizedInitial) {
      process.stderr.write(
        `Initial asset exceeds 500 KiB: ${name} (${(bytes / 1024).toFixed(2)} KiB)\n`,
      );
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
