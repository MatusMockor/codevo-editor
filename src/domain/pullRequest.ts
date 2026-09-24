import {
  hasControlCharacter,
  wireBoolean,
  wireCount,
  wireEnum,
  wireExactRecord,
  wireNullableString,
  wireString,
  wireStringArray,
} from "./wireValue";

export const MAX_PULL_REQUEST_TITLE_BYTES = 256;
export const MAX_PULL_REQUEST_BODY_BYTES = 65_536;
const MAX_URL_BYTES = 2_048;
const MAX_REF_BYTES = 512;
const MAX_COUNT = 10_000_000;
const MAX_SUBJECTS = 50;
const MAX_SUBJECT_BYTES = 200;
const FALLBACK_FAILURE_MESSAGE = "The pull request could not be created.";
const FORGES = ["github", "gitlab"] as const;

export type ForgeKind = (typeof FORGES)[number];

const FORGE_HOSTS: Readonly<Record<ForgeKind, string>> = {
  github: "github.com",
  gitlab: "gitlab.com",
};

export const PULL_REQUEST_FAILURE_KINDS = [
  "noRemote",
  "unsupportedHost",
  "cliMissing",
  "authRequired",
  "alreadyExists",
  "pushFailed",
  "forgeError",
  "invalid",
  "untrusted",
] as const;

export type PullRequestFailureKind = (typeof PULL_REQUEST_FAILURE_KINDS)[number];

export interface PullRequestContextRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly base: string | null;
}

export interface CreatePullRequestRequest {
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly base: string;
  readonly title: string;
  readonly body: string;
  readonly draft: boolean;
}

export interface PullRequestContext {
  readonly headBranch: string | null;
  readonly defaultBase: string | null;
  readonly base: string | null;
  readonly commitsAhead: number;
  readonly filesChanged: number;
  readonly unpushedCommits: number;
  readonly hasUpstream: boolean;
  readonly forge: ForgeKind | null;
  readonly cliAvailable: boolean;
  readonly commitSubjects: ReadonlyArray<string>;
  readonly compareUrl: string | null;
}

export interface PullRequestReceipt {
  readonly url: string;
  readonly forge: ForgeKind;
}

export interface PullRequestFailure {
  readonly kind: PullRequestFailureKind;
  readonly message: string;
  readonly url: string | null;
}

export interface PullRequestGateway {
  getContext(request: PullRequestContextRequest): Promise<PullRequestContext>;
  create(request: CreatePullRequestRequest): Promise<PullRequestReceipt>;
}

export type FieldValidation<T extends string> =
  | ({ readonly kind: "ok" } & Readonly<Record<T, string>>)
  | { readonly kind: "invalid"; readonly reason: string };

const encoder = new TextEncoder();
const BIDI_CONTROL = /[\u202a-\u202e\u2066-\u2069]/;
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export function validatePullRequestTitle(title: string): FieldValidation<"title"> {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return { kind: "invalid", reason: "Enter a pull request title." };
  }
  const unsafe = hasControlCharacter(trimmed) || BIDI_CONTROL.test(trimmed);
  if (encoder.encode(trimmed).length > MAX_PULL_REQUEST_TITLE_BYTES || unsafe) {
    return {
      kind: "invalid",
      reason: `Use a single-line title of at most ${MAX_PULL_REQUEST_TITLE_BYTES} bytes.`,
    };
  }
  return { kind: "ok", title: trimmed };
}

export function validatePullRequestBody(body: string): FieldValidation<"body"> {
  if (encoder.encode(body).length > MAX_PULL_REQUEST_BODY_BYTES) {
    return { kind: "invalid", reason: "The description is too long." };
  }
  if (BODY_CONTROL.test(body) || BIDI_CONTROL.test(body)) {
    return { kind: "invalid", reason: "The description contains unsupported characters." };
  }
  return { kind: "ok", body };
}

export function parsePullRequestContext(
  value: unknown,
  path = "pullRequestContext",
): PullRequestContext {
  const record = wireExactRecord(
    value,
    [
      "headBranch",
      "defaultBase",
      "base",
      "commitsAhead",
      "filesChanged",
      "unpushedCommits",
      "hasUpstream",
      "forge",
      "cliAvailable",
      "commitSubjects",
      "compareUrl",
    ],
    path,
  );
  return {
    headBranch: wireNullableString(record.headBranch, `${path}.headBranch`, MAX_REF_BYTES),
    defaultBase: wireNullableString(record.defaultBase, `${path}.defaultBase`, MAX_REF_BYTES),
    base: wireNullableString(record.base, `${path}.base`, MAX_REF_BYTES),
    commitsAhead: wireCount(record.commitsAhead, `${path}.commitsAhead`, MAX_COUNT),
    filesChanged: wireCount(record.filesChanged, `${path}.filesChanged`, MAX_COUNT),
    unpushedCommits: wireCount(record.unpushedCommits, `${path}.unpushedCommits`, MAX_COUNT),
    hasUpstream: wireBoolean(record.hasUpstream, `${path}.hasUpstream`),
    forge: record.forge === null ? null : wireEnum(record.forge, `${path}.forge`, FORGES),
    cliAvailable: wireBoolean(record.cliAvailable, `${path}.cliAvailable`),
    commitSubjects: wireStringArray(
      record.commitSubjects,
      `${path}.commitSubjects`,
      MAX_SUBJECTS,
      MAX_SUBJECT_BYTES,
    ),
    compareUrl:
      record.compareUrl === null ? null : httpsUrl(record.compareUrl, `${path}.compareUrl`),
  };
}

export function parsePullRequestReceipt(
  value: unknown,
  path = "pullRequestReceipt",
): PullRequestReceipt {
  const record = wireExactRecord(value, ["url", "forge"], path);
  const forge = wireEnum(record.forge, `${path}.forge`, FORGES);
  const url = httpsUrl(record.url, `${path}.url`);
  if (new URL(url).hostname !== FORGE_HOSTS[forge]) {
    throw new TypeError(`Invalid ${path}.url: expected a ${forge} address.`);
  }
  return { url, forge };
}

export function classifyPullRequestError(error: unknown): PullRequestFailure {
  const text = errorText(error);
  const separator = text.indexOf(":");
  const kind = PULL_REQUEST_FAILURE_KINDS.find(
    (candidate) => separator > 0 && candidate === text.slice(0, separator),
  );
  if (kind === undefined) {
    return {
      kind: "forgeError",
      message: text.length > 0 ? text : FALLBACK_FAILURE_MESSAGE,
      url: null,
    };
  }
  const detail = text.slice(separator + 1).trim();
  if (kind === "alreadyExists") {
    return {
      kind,
      message: "A pull request for this branch already exists.",
      url: safeHttpsUrl(detail),
    };
  }
  return { kind, message: detail.length > 0 ? detail : FALLBACK_FAILURE_MESSAGE, url: null };
}

export function pullRequestDraftDefaults(
  context: PullRequestContext,
  threadTitle: string | null,
): { readonly title: string; readonly body: string } {
  const subjects = [...context.commitSubjects].reverse();
  const candidates = [threadTitle?.trim() ?? "", subjects[0] ?? "", context.headBranch ?? ""];
  const titleCandidate = candidates.find((candidate) => candidate.length > 0) ?? "";
  const validated = validatePullRequestTitle(titleCandidate);
  const title = validated.kind === "ok" ? validated.title : "";
  if (subjects.length === 0) {
    return { title, body: "" };
  }
  return { title, body: `## Changes\n\n${subjects.map((subject) => `- ${subject}`).join("\n")}\n` };
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function safeHttpsUrl(text: string): string | null {
  try {
    return httpsUrl(text, "url");
  } catch {
    return null;
  }
}

function httpsUrl(value: unknown, path: string): string {
  const text = wireString(value, path, MAX_URL_BYTES);
  if (!URL.canParse(text) || new URL(text).protocol !== "https:") {
    throw new TypeError(`Invalid ${path}: expected an https address.`);
  }
  return text;
}
