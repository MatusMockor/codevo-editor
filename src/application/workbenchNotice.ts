import { createWorkbenchNotice, type WorkbenchNotice } from "../domain/workbenchNotice";

export {
  createWorkbenchNotice,
  type WorkbenchNotice,
  type WorkbenchNoticeKind,
  type WorkbenchNoticeNavigationTarget,
  type WorkbenchNoticePosition,
  type WorkbenchNoticeSeverity,
} from "../domain/workbenchNotice";

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
    `${hiddenCount} more notices were dropped to keep the list short.`,
    GLOBAL_NOTICE_OVERFLOW_GROUP_KEY,
    undefined,
    "overflow",
  );
}
