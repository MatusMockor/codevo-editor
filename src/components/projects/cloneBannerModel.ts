import {
  cloneFailureDetail,
  cloneProgressSummary,
  overallClonePercent,
  type CloneFailureDetail,
} from "../../domain/cloneStatusPresentation";
import type { LocalCloneFailure, LocalCloneProgress } from "../../domain/localProjectClone";
import type { RepositoryIdentity } from "../../domain/repositoryCloneUrl";

export type CloneBannerModel =
  | Readonly<{ kind: "running"; title: string; summary: string; percent: number | null }>
  | Readonly<{ kind: "preparing"; title: string }>
  | Readonly<{ kind: "failed"; title: string; detail: CloneFailureDetail; retryable: boolean }>
  | Readonly<{ kind: "cancelled"; title: string; detail: CloneFailureDetail; retryable: boolean }>
  | Readonly<{ kind: "none" }>;

export type CloneBannerDetail = Readonly<{
  progress: LocalCloneProgress | null;
  failure: LocalCloneFailure | null;
  source: RepositoryIdentity | null;
}>;

export type CloneBannerInput = Readonly<{
  status: string;
  name: string;
  error: string | null;
  environment: "local" | "remote";
  projectReady: boolean;
  canRetry: boolean;
  detail: CloneBannerDetail | null;
}>;

const RUNNING = new Set(["pending", "queued", "running", "cloning"]);
const COMPLETE = new Set(["completed", "succeeded"]);
const CANCELLED = new Set(["canceled", "cancelled"]);
const MAX_ERROR_CHARS = 300;
const FALLBACK_ERROR = "Cloning stopped. Retry to finish cloning.";

export function cloneBannerModel(input: CloneBannerInput): CloneBannerModel {
  const repository = input.detail?.source?.path ?? input.name;
  if (COMPLETE.has(input.status)) return completedModel(input);
  if (RUNNING.has(input.status)) return runningModel(input, repository);
  if (CANCELLED.has(input.status))
    return {
      kind: "cancelled",
      title: `Cancelled cloning ${repository}`,
      detail: { text: "Retry to bring in the repository.", command: null, tail: "" },
      retryable: input.canRetry,
    };
  return {
    kind: "failed",
    title: `Could not clone ${repository}`,
    detail: failureDetail(input),
    retryable: input.canRetry,
  };
}

export function clonePlaceholder(model: CloneBannerModel): string | undefined {
  switch (model.kind) {
    case "running":
    case "preparing":
      return "Write your first message. Sending unlocks when the clone finishes.";
    case "failed":
    case "cancelled":
      return "Your message is kept. Retry to finish cloning.";
    case "none":
      return undefined;
    default:
      return unsupportedModel(model);
  }
}

function completedModel(input: CloneBannerInput): CloneBannerModel {
  if (input.projectReady) return { kind: "none" };
  return { kind: "preparing", title: `Preparing ${input.name}` };
}

function runningModel(input: CloneBannerInput, repository: string): CloneBannerModel {
  const title = `Cloning ${repository}`;
  if (input.environment === "remote")
    return { kind: "running", title, summary: "Working on the server", percent: null };
  const progress = input.detail?.progress ?? null;
  return {
    kind: "running",
    title,
    summary: cloneProgressSummary(progress),
    percent: progress === null ? null : overallClonePercent(progress),
  };
}

function failureDetail(input: CloneBannerInput): CloneFailureDetail {
  const failure = input.detail?.failure ?? null;
  if (input.environment === "local" && failure !== null)
    return cloneFailureDetail(failure, input.detail?.source?.host ?? null);
  return {
    text: (input.error ?? FALLBACK_ERROR).slice(0, MAX_ERROR_CHARS),
    command: null,
    tail: "",
  };
}

function unsupportedModel(model: never): never {
  throw new TypeError(`Unsupported clone banner: ${JSON.stringify(model)}.`);
}
