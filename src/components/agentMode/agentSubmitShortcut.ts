export interface AgentSubmitShortcut {
  readonly glyphs: string;
  readonly keys: string;
}

export interface AgentPlatformModifier {
  readonly key: "Meta" | "Control";
  readonly glyph: "⌘" | "Ctrl";
}

const MAC_PLATFORM = /mac|iphone|ipad/i;
const MAC_MODIFIER: AgentPlatformModifier = { key: "Meta", glyph: "⌘" };
const OTHER_MODIFIER: AgentPlatformModifier = { key: "Control", glyph: "Ctrl" };

export function agentPlatformModifier(): AgentPlatformModifier {
  return MAC_PLATFORM.test(clientPlatform()) ? MAC_MODIFIER : OTHER_MODIFIER;
}

export function agentSubmitShortcut(): AgentSubmitShortcut {
  const modifier = agentPlatformModifier();
  return { glyphs: `${modifier.glyph}↩`, keys: `${modifier.key}+Enter` };
}

function clientPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const agent: Navigator & { userAgentData?: { platform?: string } } = navigator;
  return agent.userAgentData?.platform ?? navigator.userAgent;
}
