import type {
  LocalCloneFailure,
  LocalCloneProgress,
  LocalCloneProgressPhase,
} from "./localProjectClone";

export type CloneFailureDetail = Readonly<{ text: string; command: string | null; tail: string }>;

const PHASE_SPANS: Readonly<Record<LocalCloneProgressPhase, readonly [number, number]>> = {
  counting: [0, 4],
  compressing: [4, 8],
  receiving: [8, 82],
  resolving: [82, 96],
  checkingOut: [96, 100],
};

const PHASE_LABELS: Readonly<Record<LocalCloneProgressPhase, string>> = {
  counting: "Counting objects",
  compressing: "Compressing objects",
  receiving: "Receiving objects",
  resolving: "Resolving deltas",
  checkingOut: "Checking out files",
};

const MIB = 1_048_576;
const GITHUB_HOST = "github.com";
const AUTH_COMMAND_TAIL = "in a terminal, or use an SSH URL.";

export function overallClonePercent(progress: LocalCloneProgress | null): number {
  if (progress === null) return 0;
  const [start, end] = PHASE_SPANS[progress.phase];
  return Math.round(start + ((end - start) * progress.percent) / 100);
}

export function cloneProgressSummary(progress: LocalCloneProgress | null): string {
  if (progress === null) return "Starting";
  const parts = [PHASE_LABELS[progress.phase], `${progress.percent}%`];
  if (progress.receivedBytes !== null) parts.push(transferSummary(progress));
  return parts.join(" · ");
}

export function cloneFailureDetail(
  failure: LocalCloneFailure,
  host: string | null,
): CloneFailureDetail {
  const where = host ?? "the Git host";
  switch (failure) {
    case "authentication":
      return authenticationDetail(where);
    case "notFound":
      return plain(
        `Repository not found or access denied on ${where}. Check the URL and your access.`,
      );
    case "branchNotFound":
      return plain("That branch does not exist. Leave Branch empty to use the default branch.");
    case "network":
      return plain(`Could not reach ${where}. Check your connection, then retry.`);
    case "hostKey":
      return plain(
        `The SSH host key for ${where} is not trusted yet. Connect once with ssh in a terminal, then retry.`,
      );
    case "timeout":
      return plain(
        "Cloning took longer than 30 minutes and was stopped. Retry on a faster connection.",
      );
    case "destination":
      return plain(
        "The destination folder changed or could not be cleaned up. Remove the project and clone into a new folder.",
      );
    case "other":
      return plain(
        "Git could not clone the repository. Check the address and your local Git setup, then retry.",
      );
    default:
      return unsupportedFailure(failure);
  }
}

function transferSummary(progress: LocalCloneProgress): string {
  const received = `${mebibytes(progress.receivedBytes ?? 0)} MiB`;
  if (progress.bytesPerSecond === null) return received;
  return `${received} | ${mebibytes(progress.bytesPerSecond)} MiB/s`;
}

function mebibytes(bytes: number): string {
  return (bytes / MIB).toFixed(1);
}

function authenticationDetail(host: string): CloneFailureDetail {
  if (host === GITHUB_HOST)
    return {
      text: `Repository not found or access denied on ${host}. If it is private, run`,
      command: "gh auth login",
      tail: AUTH_COMMAND_TAIL,
    };
  if (host.includes("gitlab"))
    return {
      text: `Authentication failed for ${host}. Run`,
      command: "glab auth login",
      tail: AUTH_COMMAND_TAIL,
    };
  return plain(`Authentication failed for ${host}. Check your Git credentials, or use an SSH URL.`);
}

function plain(text: string): CloneFailureDetail {
  return { text, command: null, tail: "" };
}

function unsupportedFailure(failure: never): never {
  throw new TypeError(`Unsupported clone failure: ${String(failure)}.`);
}
