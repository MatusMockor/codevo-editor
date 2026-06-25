// Local History (PhpStorm-style): per-workspace snapshots of a file captured on
// save, so the user can review, diff, and revert previous versions WITHOUT git.
// All storage is isolated per workspace root in the infrastructure/Rust layer.

export interface LocalHistoryVersion {
  // Opaque, sortable identifier of this version (newest has the largest id).
  id: string;
  // Capture time in Unix milliseconds.
  timestampMs: number;
  // Byte length of the captured content.
  sizeBytes: number;
}

// A diff between a selected snapshot (original) and the file's current content
// (modified), ready to render in a Monaco diff editor.
export interface LocalHistoryDiff {
  language: string;
  // The file's content right now (right-hand, editable-looking side).
  modifiedContent: string;
  // The selected snapshot's content (left-hand, read-only side).
  originalContent: string;
}

export interface LocalHistoryGateway {
  // Captures a snapshot of `content` for `relativePath` inside `rootPath`.
  // Returns the stored version, or null when the content is identical to the
  // most recent snapshot (dedupe) and nothing was written.
  recordSnapshot(
    rootPath: string,
    relativePath: string,
    content: string,
  ): Promise<LocalHistoryVersion | null>;
  // Lists retained versions newest-first; empty when the file has no history.
  listVersions(
    rootPath: string,
    relativePath: string,
  ): Promise<LocalHistoryVersion[]>;
  // Reads the stored content of a specific version.
  readVersion(
    rootPath: string,
    relativePath: string,
    versionId: string,
  ): Promise<string>;
}

// Human-readable relative time for a snapshot timestamp (in milliseconds),
// matching the "x minutes ago" phrasing used elsewhere for git history.
export function localHistoryRelativeTime(
  timestampMs: number,
  now: number = Date.now(),
): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - timestampMs) / 1000));

  if (elapsedSeconds < 60) {
    return "just now";
  }

  const units: Array<{ label: string; seconds: number }> = [
    { label: "year", seconds: 365 * 86400 },
    { label: "month", seconds: 30 * 86400 },
    { label: "week", seconds: 7 * 86400 },
    { label: "day", seconds: 86400 },
    { label: "hour", seconds: 3600 },
    { label: "minute", seconds: 60 },
  ];

  for (const unit of units) {
    const value = Math.floor(elapsedSeconds / unit.seconds);

    if (value >= 1) {
      return `${value} ${unit.label}${value === 1 ? "" : "s"} ago`;
    }
  }

  return "just now";
}

// Absolute timestamp label shown in the version row tooltip.
export function localHistoryAbsoluteTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString();
}
