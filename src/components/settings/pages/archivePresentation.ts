export const ARCHIVE_PAGE_SIZE = 50;

export interface ArchivableThreadView {
  readonly repositoryLabel: string;
  readonly thread: {
    readonly threadId: string;
    readonly title: string;
    readonly archived: boolean;
    readonly createdAtEpochMs: number;
    readonly owner: { readonly rootKey: string };
  };
}

export interface ArchivedThreadRow {
  readonly threadId: string;
  readonly title: string;
  readonly createdLabel: string;
}

export interface ArchivedThreadGroup {
  readonly projectKey: string;
  readonly projectLabel: string;
  readonly threads: ReadonlyArray<ArchivedThreadRow>;
}

export function archivedThreadGroups(
  views: ReadonlyArray<ArchivableThreadView>,
  nowEpochMs: number,
): ReadonlyArray<ArchivedThreadGroup> {
  const byProject = new Map<string, ArchivableThreadView[]>();
  for (const view of views) {
    if (!view.thread.archived) continue;
    const bucket = byProject.get(view.thread.owner.rootKey);
    if (bucket === undefined) {
      byProject.set(view.thread.owner.rootKey, [view]);
      continue;
    }
    bucket.push(view);
  }
  return [...byProject.entries()]
    .map(([projectKey, bucket]) => ({
      projectKey,
      projectLabel: bucket[0]?.repositoryLabel ?? projectKey,
      threads: [...bucket]
        .sort((left, right) => right.thread.createdAtEpochMs - left.thread.createdAtEpochMs)
        .map((view) => ({
          threadId: view.thread.threadId,
          title: view.thread.title,
          createdLabel: `Created ${ageLabel(nowEpochMs - view.thread.createdAtEpochMs)} ago`,
        })),
    }))
    .sort(
      (left, right) =>
        left.projectLabel.localeCompare(right.projectLabel) ||
        left.projectKey.localeCompare(right.projectKey),
    );
}

function ageLabel(elapsedMs: number): string {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}
