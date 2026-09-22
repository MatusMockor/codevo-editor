import { describe, expect, it, vi } from "vitest";
import { createCloneComposerAttachments } from "./cloneComposerAttachments";
import type { AgentComposerAttachmentsSurface } from "./useAgentComposerAttachments";

const source = (name = "notes.txt") => ({
  kind: "bytes" as const,
  name,
  mime: "text/plain",
  bytes: new Uint8Array([1, 2]).buffer,
});
function targetFixture() {
  const backing = createCloneComposerAttachments();
  const sent = vi.fn();
  const prepare = vi.fn(async () => null);
  const get = (): AgentComposerAttachmentsSurface => ({
    ...backing.forClone("project", "local"),
    markSent: sent,
    prepareTurn: prepare,
  });
  return { get, sent, prepare };
}
describe("deferred clone attachments", () => {
  it("retains isolated drafts across navigation and copies mutable bytes", async () => {
    const coordinator = createCloneComposerAttachments();
    const bytes = source();
    await coordinator.forClone("a", "local").add("a", [bytes]);
    await coordinator.forClone("b", "local").add("b", [source("b.txt")]);
    expect(coordinator.forClone("a", "local").drafts.map((draft) => draft.name)).toEqual([
      "notes.txt",
    ]);
    const target = targetFixture();
    let received: ArrayBuffer | null = null;
    const get = () => ({
      ...target.get(),
      captureIntake:
        () => async (sources: Parameters<AgentComposerAttachmentsSurface["add"]>[1]) => {
          received = sources[0].kind === "bytes" ? sources[0].bytes : null;
          await target.get().add("project", sources);
        },
    });
    new Uint8Array(bytes.bytes)[0] = 9;
    expect(await coordinator.transfer("a", "project", get, () => true)).toBe(true);
    expect([...new Uint8Array(received!)]).toEqual([1, 2]);
    expect(coordinator.forClone("b", "local").drafts).toHaveLength(1);
  });
  it("rejects stale intake, wrong project, non-image remote sources, and excessive count", async () => {
    const coordinator = createCloneComposerAttachments();
    const remote = coordinator.forClone("remote", "remote");
    await remote.add("remote", [source(), { kind: "path", path: "/tmp/image.png" }]);
    expect(coordinator.forClone("remote", "remote").drafts).toHaveLength(0);
    const local = coordinator.forClone("local", "local");
    await local.add("foreign", [source()]);
    await local.captureIntake!("local", () => false)!([source()]);
    expect(coordinator.forClone("local", "local").drafts).toHaveLength(0);
    await local.add(
      "local",
      Array.from({ length: 10 }, (_, i) => source(`${i}.txt`)),
    );
    expect(coordinator.forClone("local", "local").drafts).toHaveLength(8);
    expect(coordinator.forClone("local", "local").refusal).not.toBeNull();
  });
  it("retains sources on failure and transfers before bound preparation without duplicating on retry", async () => {
    const coordinator = createCloneComposerAttachments();
    await coordinator.forClone("clone", "local").add("clone", [source()]);
    const target = targetFixture();
    const binding = { projectKey: "project", getTarget: target.get, isCurrent: () => true };
    coordinator.bind("clone", binding);
    await coordinator.forClone("clone", "local").prepareTurn("foreign");
    expect(target.prepare).not.toHaveBeenCalled();
    await coordinator.forClone("clone", "local").prepareTurn("project");
    await coordinator.forClone("clone", "local").prepareTurn("project");
    expect(target.get().drafts).toHaveLength(1);
    expect(coordinator.forClone("clone", "local").drafts).toHaveLength(1);
    expect(target.prepare).toHaveBeenCalledTimes(2);
    coordinator.forClone("clone", "local").remove(target.get().drafts[0].draftId);
    expect(target.get().drafts).toHaveLength(0);
  });
  it("cleans partially transferred sources after unbind and clone dismissal", async () => {
    const coordinator = createCloneComposerAttachments();
    await coordinator
      .forClone("clone", "local")
      .add("clone", [source("first.txt"), source("second.txt")]);
    const target = targetFixture();
    let calls = 0;
    const getTarget = () => ({
      ...target.get(),
      captureIntake:
        () => async (sources: Parameters<AgentComposerAttachmentsSurface["add"]>[1]) => {
          if (++calls === 1) await target.get().add("project", sources);
        },
    });
    coordinator.bind("clone", { projectKey: "project", getTarget, isCurrent: () => true });
    await coordinator.forClone("clone", "local").prepareTurn("project");
    expect(target.get().drafts).toHaveLength(1);
    coordinator.bind("clone", null);
    coordinator.removeClone("clone");
    expect(target.get().drafts).toHaveLength(0);
  });
  it("compensates on captured scope rather than a retargeted getter", async () => {
    const coordinator = createCloneComposerAttachments();
    await coordinator.forClone("clone", "local").add("clone", [source()]);
    const original = targetFixture();
    const foreign = targetFixture();
    let switched = false;
    const get = () =>
      switched
        ? foreign.get()
        : {
            ...original.get(),
            captureIntake: () => async () => {
              await foreign.get().add("project", [source("unrelated.txt")]);
              switched = true;
            },
          };
    expect(await coordinator.transfer("clone", "project", get, () => !switched)).toBe(false);
    expect(foreign.get().drafts).toHaveLength(1);
    coordinator.removeClone("clone");
    expect(foreign.get().drafts).toHaveLength(1);
  });
  it("bounds retained bytes and invalidates a removed clone's captured intake", async () => {
    const coordinator = createCloneComposerAttachments();
    const old = coordinator.forClone("clone", "local");
    const intake = old.captureIntake!("clone")!;
    await old.add("clone", [{ ...source(), bytes: new ArrayBuffer(40 * 1024 * 1024 + 1) }]);
    expect(coordinator.forClone("clone", "local").drafts).toHaveLength(0);
    expect(coordinator.forClone("clone", "local").refusal).toContain("40 MiB");
    coordinator.removeClone("clone");
    coordinator.forClone("clone", "local");
    await intake([source()]);
    expect(coordinator.forClone("clone", "local").drafts).toHaveLength(0);
  });
  it("preserves failed sources and rolls back a late attachment after ownership changes", async () => {
    const coordinator = createCloneComposerAttachments();
    await coordinator.forClone("clone", "local").add("clone", [source()]);
    const target = targetFixture();
    expect(
      await coordinator.transfer(
        "clone",
        "project",
        () => ({ ...target.get(), captureIntake: () => async () => undefined }),
        () => true,
      ),
    ).toBe(false);
    expect(coordinator.forClone("clone", "local").drafts).toHaveLength(1);
    let current = true;
    const get = () => ({
      ...target.get(),
      captureIntake:
        () => async (sources: Parameters<AgentComposerAttachmentsSurface["add"]>[1]) => {
          await target.get().add("project", sources);
          current = false;
        },
    });
    expect(await coordinator.transfer("clone", "project", get, () => current)).toBe(false);
    expect(target.get().drafts).toHaveLength(0);
    expect(coordinator.forClone("clone", "local").drafts).toHaveLength(1);
    coordinator.removeClone("clone");
    expect(coordinator.forClone("clone", "local").drafts).toHaveLength(0);
  });
});
