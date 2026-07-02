export type WorkbenchNoticeSeverity = "info" | "warning" | "error";

/**
 * Distinguishes special notices that need bespoke presentation from ordinary
 * diagnostics. `overflow` marks the indicator appended by
 * `capDiagnosticNotices` when a document publishes more diagnostics than the
 * panel renders, so the UI can highlight it instead of letting it blend into
 * the regular `info` rows.
 */
export type WorkbenchNoticeKind = "overflow";

export interface WorkbenchNotice {
  groupKey?: string;
  id: string;
  kind?: WorkbenchNoticeKind;
  navigationTarget?: WorkbenchNoticeNavigationTarget;
  severity: WorkbenchNoticeSeverity;
  source: string;
  message: string;
}

export interface WorkbenchNoticeNavigationTarget {
  path: string;
  range: {
    end: WorkbenchNoticePosition;
    start: WorkbenchNoticePosition;
  };
}

export interface WorkbenchNoticePosition {
  column: number;
  lineNumber: number;
}

export function createWorkbenchNotice(
  severity: WorkbenchNoticeSeverity,
  source: string,
  message: string,
  groupKey?: string,
  navigationTarget?: WorkbenchNoticeNavigationTarget,
  kind?: WorkbenchNoticeKind,
): WorkbenchNotice {
  return {
    groupKey,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    message,
    navigationTarget,
    severity,
    source,
  };
}

/**
 * Groups a PHP language server crash notice by workspace root, so the
 * "Open Runtime panel" toast action (wired in `LanguageServerCrashNotice`)
 * only ever targets the crash for the active project - never another open
 * project tab's runtime.
 */
export function languageServerCrashNoticeGroupKey(
  workspaceRoot: string | null,
): string | null {
  return workspaceRoot ? `language-server-crash:${workspaceRoot}` : null;
}

export function replaceWorkbenchNoticeGroup(
  current: WorkbenchNotice[],
  groupKey: string,
  replacements: WorkbenchNotice[],
): WorkbenchNotice[] {
  return [
    ...replacements,
    ...current.filter((notice) => notice.groupKey !== groupKey),
  ];
}

/**
 * Bounds the number of per-document diagnostic notices rendered in the notices
 * panel. A single Laravel file can publish hundreds of diagnostics; mapping
 * every one to a notice and re-rendering the panel freezes the main thread.
 *
 * Markers in the editor (Monaco `setModelMarkers`) are populated from a
 * separate, uncapped diagnostics source, so capping notices here never hides a
 * squiggle. The kept notices are the server-ordered head of the list, and an
 * `info` overflow indicator carrying the truthful hidden count is appended so
 * diagnostics are never dropped silently.
 */
export function capDiagnosticNotices(
  notices: WorkbenchNotice[],
  limit: number,
  buildOverflowNotice: (hiddenCount: number) => WorkbenchNotice,
): WorkbenchNotice[] {
  if (notices.length <= limit) {
    return notices;
  }

  const hiddenCount = notices.length - limit;
  return [...notices.slice(0, limit), buildOverflowNotice(hiddenCount)];
}

/**
 * Stable group key for the single global overflow indicator appended by
 * {@link capWorkbenchNotices}. Keyed (not text-matched) so re-capping can drop
 * the stale indicator before recomputing the truthful hidden count.
 */
export const GLOBAL_NOTICE_OVERFLOW_GROUP_KEY = "workbench-notice-overflow";

/**
 * Bounds the TOTAL number of cappable notices retained in the workbench notices
 * state.
 *
 * The per-document cap ({@link capDiagnosticNotices}) limits how many notices a
 * single file contributes, but a large project with diagnostics across thousands
 * of files would still grow the global notices list without bound. Each
 * `publishDiagnostics` runs an O(total) group replace/filter, so an unbounded
 * list turns every diagnostics event into a main-thread cost proportional to the
 * whole workspace. This caps only the cappable (diagnostic) notices to the head
 * of the list (the newest groups, which are prepended by
 * {@link replaceWorkbenchNoticeGroup}) and appends a single `warning` overflow
 * indicator carrying the truthful hidden count.
 *
 * `isCappable` decides which notices may be truncated; everything else (errors,
 * setup prompts, anything the caller wants to protect) is always retained in its
 * original position so important non-diagnostic notices are never silently
 * dropped. When omitted, every notice is cappable. Editor markers come from a
 * separate, uncapped source, so this never hides a squiggle.
 */
export function capWorkbenchNotices(
  notices: WorkbenchNotice[],
  limit: number,
  isCappable: (notice: WorkbenchNotice) => boolean = () => true,
): WorkbenchNotice[] {
  const withoutStaleOverflow = notices.filter(
    (notice) => notice.groupKey !== GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
  );

  const cappableCount = withoutStaleOverflow.reduce(
    (count, notice) => (isCappable(notice) ? count + 1 : count),
    0,
  );

  if (cappableCount <= limit) {
    if (withoutStaleOverflow.length === notices.length) {
      return notices;
    }

    return withoutStaleOverflow;
  }

  const hiddenCount = cappableCount - limit;
  let keptCappable = 0;
  const capped = withoutStaleOverflow.filter((notice) => {
    if (!isCappable(notice)) {
      return true;
    }

    if (keptCappable >= limit) {
      return false;
    }

    keptCappable += 1;
    return true;
  });

  return [...capped, buildGlobalNoticeOverflowNotice(hiddenCount)];
}

function buildGlobalNoticeOverflowNotice(hiddenCount: number): WorkbenchNotice {
  return createWorkbenchNotice(
    "warning",
    "Notices",
    `${hiddenCount} more notices hidden. Open a file to see its markers.`,
    GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
    undefined,
    "overflow",
  );
}
