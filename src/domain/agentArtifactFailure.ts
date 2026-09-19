/** Closed set of reasons a generated file cannot be shown, mapped from real failure points. */
export type AgentArtifactFailureReason =
  | "snapshotMissing"
  | "changedOnDisk"
  | "unverifiable"
  | "conversationAdvanced"
  | "notPreviewable"
  | "storageBusy"
  | "tooLarge"
  | "readFailed"
  | "previewFailed"
  | "expired";

export const AGENT_ARTIFACT_FAILURE_REASONS: readonly AgentArtifactFailureReason[] = [
  "snapshotMissing",
  "changedOnDisk",
  "unverifiable",
  "conversationAdvanced",
  "notPreviewable",
  "storageBusy",
  "tooLarge",
  "readFailed",
  "previewFailed",
  "expired",
];

const MESSAGES: Readonly<Record<AgentArtifactFailureReason, string>> = {
  snapshotMissing: "This turn has no saved snapshot of the file, so it cannot be previewed here.",
  changedOnDisk: "The file changed on disk after this turn finished.",
  unverifiable: "This turn has no recorded end time, so its files cannot be verified.",
  conversationAdvanced: "This turn's files are no longer available.",
  notPreviewable: "This file is not a regular file of a supported type, so it cannot be previewed.",
  storageBusy: "The file store is busy. Try again.",
  tooLarge: "The file is too large to preview here.",
  readFailed: "The file could not be read.",
  previewFailed: "The preview did not load.",
  expired: "The preview expired.",
};

const RETRYABLE: Readonly<Record<AgentArtifactFailureReason, boolean>> = {
  snapshotMissing: false,
  changedOnDisk: false,
  unverifiable: false,
  conversationAdvanced: false,
  notPreviewable: false,
  storageBusy: true,
  tooLarge: false,
  readFailed: true,
  previewFailed: true,
  expired: true,
};

/** Mirrors contracts/agent-artifact-errors.json; the shared contract test pins both halves. */
export const agentArtifactBackendMessages: Readonly<
  Partial<Record<AgentArtifactFailureReason, readonly string[]>>
> = {
  snapshotMissing: ["This older turn has no saved artifact snapshot."],
  changedOnDisk: ["Artifact changed while reading.", "Artifact changed after this turn ended."],
  unverifiable: ["This turn has no recorded end time, so its files cannot be verified."],
  conversationAdvanced: ["The conversation advanced before its artifact was saved."],
  notPreviewable: [
    "Artifact must be a bounded regular file without hard links.",
    "Artifact must be a regular file.",
    "Artifact content does not match its supported media type.",
    "Only HTML, PNG, JPEG and WebP artifacts are supported.",
  ],
  storageBusy: ["Artifact storage is busy. Try again."],
};

/** Refusals raised by this process itself, never sent over IPC. */
const LOCAL_MESSAGES: Readonly<Partial<Record<AgentArtifactFailureReason, readonly string[]>>> = {
  tooLarge: ["Artifact exceeds preview limit."],
};

function classifiers(): ReadonlyArray<readonly [string, AgentArtifactFailureReason]> {
  const table: Array<readonly [string, AgentArtifactFailureReason]> = [];
  for (const source of [agentArtifactBackendMessages, LOCAL_MESSAGES]) {
    for (const [reason, messages] of Object.entries(source)) {
      for (const message of messages ?? [])
        table.push([message, reason as AgentArtifactFailureReason]);
    }
  }
  return table;
}

const CLASSIFIERS = classifiers();

const CLASSIFIER_INPUT_LIMIT = 1024;

export function agentArtifactFailureMessage(reason: AgentArtifactFailureReason): string {
  return MESSAGES[reason];
}

export function agentArtifactFailureRetryable(reason: AgentArtifactFailureReason): boolean {
  return RETRYABLE[reason];
}

export function classifyAgentArtifactFailure(
  error: unknown,
  fallback: AgentArtifactFailureReason = "readFailed",
): AgentArtifactFailureReason {
  const raw = error instanceof Error ? error.message : String(error);
  const bounded = raw.slice(0, CLASSIFIER_INPUT_LIMIT);
  const matched = CLASSIFIERS.find(([needle]) => bounded.includes(needle));
  if (matched === undefined) return fallback;
  return matched[1];
}
