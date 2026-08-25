export interface AgentSubmitShortcut {
  readonly glyphs: string;
  readonly keys: string;
}

const MAC_PLATFORM = /mac|iphone|ipad/i;

export function agentSubmitShortcut(): AgentSubmitShortcut {
  if (MAC_PLATFORM.test(clientPlatform())) return { glyphs: "⌘↩", keys: "Meta+Enter" };
  return { glyphs: "Ctrl↩", keys: "Control+Enter" };
}

function clientPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const agent: Navigator & { userAgentData?: { platform?: string } } = navigator;
  return agent.userAgentData?.platform ?? navigator.userAgent;
}
