import { describe, expect, it } from "vitest";
import { AGENT_SIDEBAR_RAIL_STORAGE_KEY } from "./infrastructure/browserAgentSidebarRailPreference";
import {
  STARTUP_RAIL_ATTRIBUTE,
  applyStartupRail,
  type StartupRailEnvironment,
} from "./startupRail";

interface Applied {
  readonly attributes: Record<string, string>;
  readonly requestedKeys: readonly string[];
}

function apply(stored: () => string | null): Applied {
  const attributes: Record<string, string> = {};
  const requestedKeys: string[] = [];
  const environment: StartupRailEnvironment = {
    readSetting: (key) => {
      requestedKeys.push(key);
      return stored();
    },
    setDocumentAttribute: (name, value) => {
      attributes[name] = value;
    },
  };
  applyStartupRail(environment);
  return { attributes, requestedKeys };
}

describe("applyStartupRail", () => {
  it("reads the same global rail preference the sidebar persists", () => {
    expect(apply(() => null).requestedKeys).toEqual([AGENT_SIDEBAR_RAIL_STORAGE_KEY]);
  });

  it("stamps a collapsed rail so the skeleton paints no sidebar", () => {
    expect(apply(() => "collapsed").attributes).toEqual({ [STARTUP_RAIL_ATTRIBUTE]: "collapsed" });
  });

  it("stamps an expanded rail for a stored, missing, unknown or unreadable preference", () => {
    const expanded = { [STARTUP_RAIL_ATTRIBUTE]: "expanded" };
    expect(apply(() => "expanded").attributes).toEqual(expanded);
    expect(apply(() => null).attributes).toEqual(expanded);
    expect(apply(() => "sideways").attributes).toEqual(expanded);
    expect(
      apply(() => {
        throw new Error("storage denied");
      }).attributes,
    ).toEqual(expanded);
  });
});
