import { createWorkbenchNotice, type WorkbenchNotice } from "../domain/workbenchNotice";
import { JS_TEST_PROBLEM_GROUP_PREFIX } from "../domain/jsTestProblems";

export {
  createWorkbenchNotice,
  type WorkbenchNotice,
  type WorkbenchNoticeKind,
  type WorkbenchNoticeNavigationTarget,
  type WorkbenchNoticePosition,
  type WorkbenchNoticeSeverity,
} from "../domain/workbenchNotice";

/**
 * Groups a PHP language server crash notice by workspace root, so the
 * "Open Runtime panel" toast action (wired in `LanguageServerCrashNotice`)
 * only ever targets the crash for the active project - never another open
 * project tab's runtime.
 */
export function languageServerCrashNoticeGroupKey(workspaceRoot: string | null): string | null {
  return workspaceRoot ? `language-server-crash:${workspaceRoot}` : null;
}

export function languageServerRequestErrorNoticeGroupKey(
  workspaceRoot: string | null,
): string | null {
  return workspaceRoot ? `language-server-request-error:${workspaceRoot}` : null;
}

export function languageServerRequestErrorToastDismissKey(
  workspaceRoot: string | null,
  message: string,
): string | null {
  return workspaceRoot
    ? JSON.stringify(["language-server-request-error", workspaceRoot, message])
    : null;
}

export function replaceWorkbenchNoticeGroup(
  current: WorkbenchNotice[],
  groupKey: string,
  replacements: WorkbenchNotice[],
): WorkbenchNotice[] {
  return [...replacements, ...current.filter((notice) => notice.groupKey !== groupKey)];
}

export function replaceNodePackageTaskProblemNotices(
  current: WorkbenchNotice[],
  replacements: readonly WorkbenchNotice[],
): WorkbenchNotice[] {
  return [
    ...replacements,
    ...current.filter((notice) => !notice.groupKey?.startsWith("node-package-task-problems:")),
  ];
}

export function replaceJsTestProblemNotices(
  current: WorkbenchNotice[],
  replacements: readonly WorkbenchNotice[],
): WorkbenchNotice[] {
  return [
    ...replacements,
    ...current.filter((notice) => !notice.groupKey?.startsWith(JS_TEST_PROBLEM_GROUP_PREFIX)),
  ];
}

/**
 * Bounds the number of per-document diagnostic notices rendered in the notices
 * panel. A single Laravel file can publish hundreds of diagnostics; mapping
 * every one to a notice and re-rendering the panel freezes the main thread.
 *
 * Monaco markers use their own bounded projection. The kept notices are the
 * server-ordered head of the list, and an `info` overflow indicator carrying
 * the truthful hidden count is appended so list truncation is never silent.
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
 * dropped. When omitted, every notice is cappable.
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
    `${hiddenCount} additional diagnostic notices are not shown in Problems.`,
    GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
    undefined,
    "overflow",
  );
}
