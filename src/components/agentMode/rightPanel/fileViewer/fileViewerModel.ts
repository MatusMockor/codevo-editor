export const FILE_VIEWER_LINE_HEIGHT_PX = 22;
export const FILE_VIEWER_LINE_HEIGHT_RATIO = 1.6;
export const FILE_VIEWER_BLOCK_LINES = 64;
export const FILE_VIEWER_OVERSCAN_BLOCKS = 1;
export const FILE_VIEWER_FALLBACK_VIEWPORT_PX = 640;
export const FILE_VIEWER_WIDE_MIN_WIDTH_PX = 760;
export const FILES_TIGHT_BELOW_WIDTH_PX = 480;
export const FILE_VIEWER_CRUMBS_COMPACT_BELOW_WIDTH_PX = 300;

export function fileViewerCrumbsCompact(width: number): boolean {
  return width > 0 && width < FILE_VIEWER_CRUMBS_COMPACT_BELOW_WIDTH_PX;
}

export interface FileViewerCrumb {
  readonly label: string;
  readonly directory: string | null;
}

export interface FileViewerWindow {
  readonly firstBlock: number;
  readonly lastBlock: number;
  readonly before: number;
  readonly after: number;
}

export interface FileViewerWindowRequest {
  readonly heights: ReadonlyArray<number>;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

export function relativePathWithin(root: string, absolutePath: string): string | null {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  if (!absolutePath.startsWith(`${base}/`)) return null;
  const relative = absolutePath.slice(base.length + 1);
  const valid = relative
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
  return valid ? relative : null;
}

export interface FileViewerCheckout {
  readonly projectRoot: string;
  readonly checkoutRoot: string;
}

export function relativePathInTree(
  treeRoot: string,
  absolutePath: string,
  checkout: FileViewerCheckout | null,
): string | null {
  const inside = relativePathWithin(treeRoot, absolutePath);
  if (inside !== null || checkout === null) return inside;
  if (trimSlash(checkout.checkoutRoot) !== trimSlash(treeRoot)) return null;
  return relativePathWithin(checkout.projectRoot, absolutePath);
}

function trimSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function fileViewerCrumbs(
  root: string,
  relativePath: string,
): ReadonlyArray<FileViewerCrumb> {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  const rootName = base.slice(base.lastIndexOf("/") + 1) || base;
  const segments = relativePath.split("/");
  const crumbs: FileViewerCrumb[] = [{ label: rootName, directory: base }];
  let directory = base;
  segments.forEach((segment, index) => {
    directory = `${directory}/${segment}`;
    crumbs.push({ label: segment, directory: index === segments.length - 1 ? null : directory });
  });
  return crumbs;
}

export function directoriesToReveal(root: string, directory: string): ReadonlyArray<string> {
  const base = root.endsWith("/") ? root.slice(0, -1) : root;
  const relative = relativePathWithin(base, directory);
  if (relative === null) return [];
  const result: string[] = [];
  let current = base;
  for (const segment of relative.split("/")) {
    current = `${current}/${segment}`;
    result.push(current);
  }
  return result;
}

export function fileViewerBlockCount(lineCount: number): number {
  return Math.max(1, Math.ceil(lineCount / FILE_VIEWER_BLOCK_LINES));
}

export function estimatedBlockHeight(
  block: number,
  lineCount: number,
  lineHeight: number = FILE_VIEWER_LINE_HEIGHT_PX,
): number {
  const start = block * FILE_VIEWER_BLOCK_LINES;
  const lines = Math.max(0, Math.min(FILE_VIEWER_BLOCK_LINES, lineCount - start));
  return Math.max(1, lines) * lineHeight;
}

export function fileViewerWindow({
  heights,
  scrollTop,
  viewportHeight,
}: FileViewerWindowRequest): FileViewerWindow {
  const viewport = viewportHeight > 0 ? viewportHeight : FILE_VIEWER_FALLBACK_VIEWPORT_PX;
  const top = Math.max(0, scrollTop);
  const bottom = top + viewport;
  let offset = 0;
  let first = -1;
  let last = heights.length - 1;
  for (let index = 0; index < heights.length; index += 1) {
    const end = offset + (heights[index] ?? 0);
    if (first < 0 && end > top) first = index;
    if (offset >= bottom) {
      last = index - 1;
      break;
    }
    offset = end;
  }
  if (first < 0) first = Math.max(0, heights.length - 1);
  const firstBlock = Math.max(0, first - FILE_VIEWER_OVERSCAN_BLOCKS);
  const lastBlock = Math.min(
    heights.length - 1,
    Math.max(first, last) + FILE_VIEWER_OVERSCAN_BLOCKS,
  );
  return {
    firstBlock,
    lastBlock,
    before: sumHeights(heights, 0, firstBlock),
    after: sumHeights(heights, lastBlock + 1, heights.length),
  };
}

export function blockOffset(heights: ReadonlyArray<number>, block: number): number {
  return sumHeights(heights, 0, block);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export function truncatedPreviewNote(byteLength: number): string {
  return `Preview limited to the first 1 MB of a ${formatFileSize(byteLength)} file.`;
}

function sumHeights(heights: ReadonlyArray<number>, from: number, to: number): number {
  let total = 0;
  for (let index = from; index < to; index += 1) total += heights[index] ?? 0;
  return total;
}
