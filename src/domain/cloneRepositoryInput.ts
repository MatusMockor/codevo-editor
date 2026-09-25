import { parseRepositoryCloneUrl, type RepositoryIdentity } from "./repositoryCloneUrl";

export type CloneInputTransport = "https" | "ssh";
export type CloneRepositoryInput =
  | Readonly<{ kind: "empty" }>
  | Readonly<{ kind: "credentials" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{
      kind: "ok";
      url: string;
      identity: RepositoryIdentity;
      transport: CloneInputTransport;
      shorthand: boolean;
    }>;

const MAX_INPUT_CHARS = 2048;
const EMPTY: CloneRepositoryInput = Object.freeze({ kind: "empty" });
const INVALID: CloneRepositoryInput = Object.freeze({ kind: "invalid" });
const CREDENTIALS: CloneRepositoryInput = Object.freeze({ kind: "credentials" });
const URL_WITH_USERINFO = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*@/i;
const SSH_USER_ONLY = /^ssh:\/\/[A-Za-z0-9_][A-Za-z0-9_-]{0,63}@[^/:@\s]+(?::\d+)?\//;
const BARE_HOST_PATH = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\/[^\s]+$/;
const OWNER_REPO = /^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?$/;

export function resolveCloneRepositoryInput(
  raw: string,
  shorthandHost: string | null,
): CloneRepositoryInput {
  const value = raw.trim();
  if (value === "") return EMPTY;
  if (value.length > MAX_INPUT_CHARS) return INVALID;
  if (carriesCredentials(value)) return CREDENTIALS;
  const direct = parseRepositoryCloneUrl(value);
  if (direct !== null)
    return {
      kind: "ok",
      url: value,
      identity: direct,
      transport: value.startsWith("https://") ? "https" : "ssh",
      shorthand: false,
    };
  const bare = bareHostInput(value);
  if (bare !== null) return bare;
  return shorthandInput(value, shorthandHost);
}

export function carriesCredentials(value: string): boolean {
  return URL_WITH_USERINFO.test(value) && !SSH_USER_ONLY.test(value);
}

export function looksLikeCloneSource(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_INPUT_CHARS) return false;
  return (
    carriesCredentials(value) ||
    parseRepositoryCloneUrl(value) !== null ||
    BARE_HOST_PATH.test(value)
  );
}

function bareHostInput(value: string): CloneRepositoryInput | null {
  if (!BARE_HOST_PATH.test(value)) return null;
  const url = `https://${value}`;
  const identity = parseRepositoryCloneUrl(url);
  if (identity === null) return null;
  return { kind: "ok", url, identity, transport: "https", shorthand: false };
}

function shorthandInput(value: string, shorthandHost: string | null): CloneRepositoryInput {
  if (shorthandHost === null) return INVALID;
  const shorthand = OWNER_REPO.exec(value);
  if (shorthand === null) return INVALID;
  const url = `https://${shorthandHost}/${shorthand[1]}/${shorthand[2]}.git`;
  const identity = parseRepositoryCloneUrl(url);
  if (identity === null) return INVALID;
  return { kind: "ok", url, identity, transport: "https", shorthand: true };
}
