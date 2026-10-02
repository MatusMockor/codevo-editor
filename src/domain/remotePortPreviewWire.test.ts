import { describe, expect, it } from "vitest";
import wireContract from "../../contracts/remote-port-preview-wire.json";
import {
  REMOTE_PORT_LIMITS,
  isRemotePortOwnerId,
  isRemotePortPath,
  remotePortPreviewWireChecks,
} from "./remotePortPreviewWire";

type WireCase = Readonly<{ name: string; value: unknown }>;
type WireSection = Readonly<{ accepted: readonly WireCase[]; rejected: readonly WireCase[] }>;
type PortPreviewWireContract = Readonly<{
  schemaVersion: number;
  capability: string;
  sections: Readonly<Record<string, WireSection>>;
}>;

const contract = wireContract as unknown as PortPreviewWireContract;
const sections = Object.entries(contract.sections);
const checkFor = (section: string) => {
  const check = remotePortPreviewWireChecks[section];
  expect(check).toBeDefined();
  return check ?? (() => false);
};
const acceptedCases = sections.flatMap(([section, cases]) =>
  cases.accepted.map((fixture) => [section, fixture.name, fixture.value] as const),
);
const rejectedCases = sections.flatMap(([section, cases]) =>
  cases.rejected.map((fixture) => [section, fixture.name, fixture.value] as const),
);

describe("remote port preview wire contract", () => {
  it("pins the schema and capability", () => {
    expect(contract.schemaVersion).toBe(1);
    expect(contract.capability).toBe("portPreview");
    expect(REMOTE_PORT_LIMITS).toMatchObject({ minPort: 1024, maxPort: 65535, ports: 32 });
  });

  it("validates exactly the fixture sections", () => {
    expect(Object.keys(remotePortPreviewWireChecks).sort()).toEqual(
      Object.keys(contract.sections).sort(),
    );
    for (const [, cases] of sections) {
      expect(cases.accepted.length).toBeGreaterThan(0);
      expect(cases.rejected.length).toBeGreaterThan(0);
    }
  });

  it.each(acceptedCases)("%s accepts %s", (section, _name, value) => {
    expect(checkFor(section)(value)).toBe(true);
  });

  it.each(rejectedCases)("%s rejects %s", (section, _name, value) => {
    expect(checkFor(section)(value)).toBe(false);
  });

  it("rejects lone surrogates that cannot cross the Rust boundary", () => {
    expect(isRemotePortOwnerId("workspace-\ud800")).toBe(false);
    expect(isRemotePortPath("/\udfff")).toBe(false);
    expect(isRemotePortPath("/\u{1F600}")).toBe(true);
  });
});
