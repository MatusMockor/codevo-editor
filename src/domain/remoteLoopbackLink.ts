import { classifyLoopbackUrl, isLoopbackHost, type RemoteLoopbackUrl } from "./remotePortPreview";

const MAX_LINK_LENGTH = 4096;

export type ServerLoopbackPorts =
  | Readonly<{ kind: "unsupported" }>
  | Readonly<{ kind: "unavailable"; reason: string }>
  | Readonly<{ kind: "unlisted" }>
  | Readonly<{ kind: "listed"; ports: ReadonlySet<number> }>;

export type ServerLoopbackDecision =
  | Readonly<{ kind: "open"; target: RemoteLoopbackUrl }>
  | Readonly<{ kind: "verify"; target: RemoteLoopbackUrl }>
  | Readonly<{ kind: "notice"; message: string }>;

const parsedHost = (url: string): string | null => {
  if (typeof url !== "string" || url.length > MAX_LINK_LENGTH) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

export const mayPointToServerLoopback = (url: string): boolean => {
  const host = parsedHost(url);
  return host === null || isLoopbackHost(host);
};

export type ServerLoopbackTitle =
  Readonly<{ kind: "forwarding"; server: string }> | Readonly<{ kind: "blocked"; reason: string }>;

export const SERVER_LINK_REFUSED_MESSAGE = "This link cannot be opened from a server conversation.";

export const serverPortNotRunningMessage = (port: number): string =>
  `Port ${port} is not running on the server. Open the server Terminal to keep a dev server running after the turn.`;

export const serverLoopbackUnsupportedMessage = (server: string): string =>
  `This link points to ${server}. Update the runner to open server ports from this computer.`;

export const serverLoopbackUnreachableMessage = (server: string): string =>
  `This link points to localhost on ${server} and cannot be opened from this computer.`;

export const serverLoopbackTitle = (
  ports: ServerLoopbackPorts,
  server: string,
): ServerLoopbackTitle => {
  switch (ports.kind) {
    case "listed":
    case "unlisted":
      return { kind: "forwarding", server };
    case "unsupported":
      return { kind: "blocked", reason: serverLoopbackUnsupportedMessage(server) };
    case "unavailable":
      return { kind: "blocked", reason: ports.reason };
    default: {
      const unreachable: never = ports;
      return unreachable;
    }
  }
};

export const serverLoopbackLinkTitle = (url: string, title: ServerLoopbackTitle): string | null => {
  const target = classifyLoopbackUrl(url);
  if (target === null) return null;
  if (title.kind === "blocked") return title.reason;
  return `Opens ${title.server}:${target.port} through the SSH connection`;
};

const notice = (message: string): ServerLoopbackDecision => ({ kind: "notice", message });

const unforwardableNotice = (url: string, server: string): ServerLoopbackDecision =>
  notice(
    parsedHost(url) === null
      ? SERVER_LINK_REFUSED_MESSAGE
      : serverLoopbackUnreachableMessage(server),
  );

export const serverLoopbackDecision = (
  url: string,
  ports: ServerLoopbackPorts,
  server: string,
): ServerLoopbackDecision => {
  const target = classifyLoopbackUrl(url);
  if (target === null) return unforwardableNotice(url, server);
  switch (ports.kind) {
    case "unsupported":
      return notice(serverLoopbackUnsupportedMessage(server));
    case "unavailable":
      return notice(ports.reason);
    case "unlisted":
      return { kind: "open", target };
    case "listed":
      if (ports.ports.has(target.port)) return { kind: "open", target };
      return { kind: "verify", target };
    default: {
      const unreachable: never = ports;
      return unreachable;
    }
  }
};

export const verifiedServerLoopbackDecision = (
  target: RemoteLoopbackUrl,
  listed: ReadonlySet<number>,
): ServerLoopbackDecision => {
  if (listed.has(target.port)) return { kind: "open", target };
  return notice(serverPortNotRunningMessage(target.port));
};
