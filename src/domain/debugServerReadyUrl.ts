export const DEBUG_SERVER_READY_URL_MAX_BYTES = 4 * 1024;

declare const debugServerReadyLoopbackUrlBrand: unique symbol;

/**
 * A fully parsed and serialized HTTP(S) URL whose authority is an explicit loopback host and port.
 * The brand is minted only by `validateDebugServerReadyLoopbackUrl`.
 */
export type DebugServerReadyLoopbackUrl = string & {
  readonly [debugServerReadyLoopbackUrlBrand]: true;
};

export type DebugServerReadyLoopbackUrlValidation =
  | { readonly kind: "valid"; readonly url: DebugServerReadyLoopbackUrl }
  | { readonly kind: "invalid" };

export interface DebugServerReadyExternalUrlOpener {
  openExternal(url: DebugServerReadyLoopbackUrl): Promise<void>;
}

/**
 * Validates the final URL after server-ready capture substitution.
 *
 * This deliberately accepts only an explicitly-port-bound local development server. Paths,
 * queries and fragments are retained, while credentials and non-loopback authorities fail closed.
 */
export function validateDebugServerReadyLoopbackUrl(
  value: unknown,
): DebugServerReadyLoopbackUrlValidation {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim() ||
    containsControlCharacter(value) ||
    utf8Length(value) > DEBUG_SERVER_READY_URL_MAX_BYTES
  ) {
    return invalid();
  }

  const authority = explicitAuthority(value);
  if (!authority) return invalid();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !loopbackHost(authority.host, parsed.hostname) ||
    parsed.port !== authority.port
  ) {
    return invalid();
  }

  const serialized = parsed.href;
  if (utf8Length(serialized) > DEBUG_SERVER_READY_URL_MAX_BYTES) return invalid();
  return { kind: "valid", url: serialized as DebugServerReadyLoopbackUrl };
}

interface ExplicitAuthority {
  readonly host: string;
  readonly port: string;
}

function explicitAuthority(value: string): ExplicitAuthority | null {
  const scheme = /^(https?):\/\//.exec(value);
  if (!scheme) return null;
  const authorityStart = scheme[0].length;
  const relativeEnd = value.slice(authorityStart).search(/[/?#]/);
  const authorityEnd =
    relativeEnd === -1 ? value.length : authorityStart + relativeEnd;
  const authority = value.slice(authorityStart, authorityEnd);
  if (authority.length === 0 || authority.includes("@")) return null;

  let host: string;
  let port: string;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket === -1) return null;
    host = authority.slice(0, closingBracket + 1);
    const remainder = authority.slice(closingBracket + 1);
    if (!remainder.startsWith(":")) return null;
    port = remainder.slice(1);
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon <= 0 || authority.slice(0, colon).includes(":")) return null;
    host = authority.slice(0, colon);
    port = authority.slice(colon + 1);
  }

  if (
    !/^[1-9][0-9]{0,4}$/.test(port) ||
    Number(port) > 65_535
  ) {
    return null;
  }
  return { host, port };
}

function loopbackHost(rawHost: string, parsedHostname: string): boolean {
  if (rawHost === "localhost") return parsedHostname === "localhost";
  if (rawHost === "[::1]") return parsedHostname === "[::1]";
  if (!canonicalIpv4(rawHost) || rawHost !== parsedHostname) return false;
  return rawHost.startsWith("127.");
}

function canonicalIpv4(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every(
      (octet) =>
        /^(0|[1-9][0-9]{0,2})$/.test(octet) &&
        Number(octet) <= 255,
    )
  );
}

function containsControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function invalid(): DebugServerReadyLoopbackUrlValidation {
  return { kind: "invalid" };
}
