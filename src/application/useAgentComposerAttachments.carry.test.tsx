// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_IMAGE_MAX_MODEL_BYTES, MAX_AGENT_TURN_ATTACHMENTS } from "../domain/agentAttachment";
import {
  AGENT_ATTACHMENT_COUNT_REFUSAL,
  AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
  AGENT_ATTACHMENT_PATH_REFUSAL,
} from "../domain/agentAttachmentIntake";
import {
  AGENT_ATTACHMENT_CARRY_UNAVAILABLE_NOTICE,
  boundedAgentAttachmentCarryFailure,
  carryAgentAttachmentDrafts,
  issueAgentAttachmentCarry,
  MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS,
  redeemAgentAttachmentCarry,
} from "./agentAttachmentCarry";
import {
  AGENT_ATTACHMENT_INTAKE_BUSY_REFUSAL,
  agentAttachmentIntakeTicketIsOpen,
  closeAgentAttachmentIntakeTicket,
  MAX_PENDING_AGENT_ATTACHMENT_INTAKES,
} from "./agentAttachmentIntakeTickets";
import {
  gate,
  image,
  mountMachine,
  owner,
  settle,
  states,
  textFile,
  type Machine,
} from "./agentAttachmentMachineTestSupport";
import { AGENT_ATTACHMENTS_DISCARDED_NOTICE } from "./agentTurnAttachments";
import {
  AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX,
  type AgentComposerAttachmentsSurface,
} from "./useAgentComposerAttachments";

const LOCAL_ROOT = "/workspace/app";
const SERVER_ROOT = "remote:server:runner:project";
const LOCAL_KEY = `new:${LOCAL_ROOT}`;
const SERVER_KEY = `new:${SERVER_ROOT}`;

describe("carrying attachment drafts between execution machines", () => {
  let local: Machine;
  let server: Machine;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    local = mountMachine("local", LOCAL_ROOT);
    server = mountMachine("server", SERVER_ROOT);
  });

  afterEach(() => {
    local.unmount();
    server.unmount();
  });

  function carryToServer(): void {
    act(() =>
      carryAgentAttachmentDrafts(local.scope(LOCAL_KEY), server.scope(SERVER_KEY), SERVER_ROOT),
    );
  }

  function carryToLocal(): void {
    act(() =>
      carryAgentAttachmentDrafts(server.scope(SERVER_KEY), local.scope(LOCAL_KEY), LOCAL_ROOT),
    );
  }

  it("moves a ready image to the destination machine with a working preview", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    const original = local.scope(LOCAL_KEY).drafts[0];
    expect(original).toMatchObject({ state: "ready", attachmentId: "local-1" });

    carryToServer();
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
    expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:staging"]);
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready"]));

    const carried = server.scope(SERVER_KEY).drafts[0];
    expect(carried).toMatchObject({ kind: "image", attachmentId: "server-1", mime: "image/png" });
    expect(carried?.previewUrl).toBe("blob:server-1");
    expect(server.staged).toEqual([
      { workspaceId: `workspace:${SERVER_ROOT}`, attachmentId: "server-1" },
    ]);
    expect(local.released).toEqual(["local-1"]);
    expect(local.revoked).toEqual([original?.previewUrl]);
    expect(local.scope(LOCAL_KEY).refusal).toBeNull();
  });

  it("makes the carried image submittable under the destination owner", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    carryToServer();
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready"]));

    let prepared: Awaited<ReturnType<AgentComposerAttachmentsSurface["prepareTurn"]>> = null;
    await act(async () => {
      prepared = await server.scope(SERVER_KEY).prepareTurn(SERVER_ROOT);
    });
    expect(prepared).toMatchObject({
      owner: owner(SERVER_ROOT),
      intents: [{ kind: "staged", attachmentId: "server-1", name: "shot.png" }],
    });
    await act(async () => {
      expect(await local.scope(LOCAL_KEY).prepareTurn(LOCAL_ROOT)).toBeNull();
    });
  });

  it("returns the same attachments when carried back and never duplicates them", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image(), textFile()]));
    carryToServer();
    await settle(() =>
      expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready", "notes.txt:ready"]),
    );
    carryToLocal();
    await settle(() =>
      expect(states(local.scope(LOCAL_KEY))).toEqual(["shot.png:ready", "notes.txt:ready"]),
    );
    expect(states(server.scope(SERVER_KEY))).toEqual([]);
    carryToServer();
    await settle(() =>
      expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready", "notes.txt:ready"]),
    );
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
    expect(local.released).toEqual(["local-1", "local-2", "local-3", "local-4"]);
    expect(server.released).toEqual(["server-1", "server-2"]);
  });

  it("re-takes an attachment that was still being taken in and drops the late result", async () => {
    const held = (local.stageGate = gate());
    let intake: Promise<void> = Promise.resolve();
    act(() => {
      intake = local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]);
    });
    await settle(() => expect(states(local.scope(LOCAL_KEY))).toEqual(["shot.png:staging"]));

    carryToServer();
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready"]));
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);

    await act(async () => {
      held.open();
      await intake;
    });
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
    expect(local.released).toEqual(["local-1"]);
    expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready"]);
  });

  it("keeps an attachment the destination cannot take visible and restores it on the way back", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    server.stageError = new Error("Remote attachments require a PNG/JPEG image up to 5 MiB.");

    carryToServer();
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:failed"]));
    expect(server.scope(SERVER_KEY).drafts[0]?.failure).toBe(
      `${AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX}Remote attachments require a PNG/JPEG image up to 5 MiB.`,
    );
    expect(server.scope(SERVER_KEY).blocked).toBe(true);
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);

    carryToLocal();
    await settle(() => expect(states(local.scope(LOCAL_KEY))).toEqual(["shot.png:ready"]));
    expect(states(server.scope(SERVER_KEY))).toEqual([]);
  });

  it("keeps an image the destination staged but may not send visible and releases its copy", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    server.stagedBytes = AGENT_IMAGE_MAX_MODEL_BYTES + 1;

    carryToServer();
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:failed"]));

    expect(server.scope(SERVER_KEY).drafts[0]).toMatchObject({
      failure: AGENT_ATTACHMENT_IMAGE_BYTES_REFUSAL,
      attachmentId: null,
      previewUrl: null,
    });
    expect(server.scope(SERVER_KEY).refusal).toBeNull();
    expect(server.released).toEqual(["server-1"]);
    expect(server.revoked).toEqual(server.issued);

    carryToLocal();
    await settle(() => expect(states(local.scope(LOCAL_KEY))).toEqual(["shot.png:ready"]));
  });

  it("keeps a path reference visible where paths are unavailable and restores it locally", async () => {
    await act(() =>
      local.scope(LOCAL_KEY).add(LOCAL_ROOT, [{ kind: "path", path: "/Users/dev/spec.pdf" }]),
    );
    expect(local.scope(LOCAL_KEY).drafts).toMatchObject([{ kind: "reference", state: "ready" }]);
    server.inspectError = new Error("Local file paths are unavailable.");

    carryToServer();
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["spec.pdf:failed"]));
    expect(server.scope(SERVER_KEY).drafts[0]?.failure).toBe(AGENT_ATTACHMENT_PATH_REFUSAL);
    expect(server.errors).toEqual([server.inspectError]);

    carryToLocal();
    await settle(() => expect(states(local.scope(LOCAL_KEY))).toEqual(["spec.pdf:ready"]));
    expect(local.scope(LOCAL_KEY).drafts[0]).toMatchObject({
      kind: "reference",
      path: "/Users/dev/spec.pdf",
    });
  });

  it("keeps attachments beyond the destination's limit visible instead of dropping them", async () => {
    const existing = Array.from({ length: MAX_AGENT_TURN_ATTACHMENTS }, (_, index) =>
      image(`server-${index}.png`),
    );
    await act(() => server.scope(SERVER_KEY).add(SERVER_ROOT, existing));
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));

    carryToServer();
    const carried = server.scope(SERVER_KEY).drafts[MAX_AGENT_TURN_ATTACHMENTS];
    expect(server.scope(SERVER_KEY).drafts).toHaveLength(MAX_AGENT_TURN_ATTACHMENTS + 1);
    expect(carried).toMatchObject({
      name: "shot.png",
      state: "failed",
      failure: AGENT_ATTACHMENT_COUNT_REFUSAL,
    });
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
  });

  it("leaves the drafts where they are when the destination cannot own them", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    server.owners.clear();

    carryToServer();

    expect(states(local.scope(LOCAL_KEY))).toEqual(["shot.png:ready"]);
    expect(local.released).toEqual([]);
    expect(states(server.scope(SERVER_KEY))).toEqual([]);
    expect(server.scope(SERVER_KEY).refusal).toBe(AGENT_ATTACHMENT_CARRY_UNAVAILABLE_NOTICE);
  });

  it("fails closed when the destination owner generation changes during the carry", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    const held = (server.stageGate = gate());

    carryToServer();
    await settle(() => expect(server.gateway.stageAgentAttachmentBytes).toHaveBeenCalledOnce());
    server.owners.set(SERVER_ROOT, owner(SERVER_ROOT, 2));
    await act(async () => {
      held.open();
      await held.promise;
    });
    await settle(() => expect(server.released).toEqual(["server-1"]));

    expect(states(server.scope(SERVER_KEY))).toEqual([]);
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
    expect(server.scope(`new:${SERVER_ROOT}:other`).drafts).toEqual([]);
  });

  it("does not resurrect drafts whose owner generation was replaced before the carry", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    carryToServer();
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready"]));

    server.owners.set(SERVER_ROOT, owner(SERVER_ROOT, 2));
    carryToLocal();

    expect(server.scope(SERVER_KEY).drafts).toEqual([]);
    expect(server.scope(SERVER_KEY).refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(server.released).toEqual(["server-1"]);
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
  });

  it("drops a destination's stale drafts before taking the carried ones", async () => {
    await act(() => server.scope(SERVER_KEY).add(SERVER_ROOT, [image("stale.png")]));
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    server.owners.set(SERVER_ROOT, owner(SERVER_ROOT, 2));

    carryToServer();
    await settle(() => expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready"]));

    expect(server.released).toEqual(["server-1"]);
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
  });

  it("settles on one copy when the user switches back before the carry finished", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    const held = (server.stageGate = gate());

    carryToServer();
    await settle(() => expect(server.gateway.stageAgentAttachmentBytes).toHaveBeenCalledOnce());
    carryToLocal();
    await settle(() => expect(states(local.scope(LOCAL_KEY))).toEqual(["shot.png:ready"]));
    expect(states(server.scope(SERVER_KEY))).toEqual([]);

    await act(async () => {
      held.open();
      await held.promise;
    });
    await settle(() => expect(server.released).toEqual(["server-1"]));
    expect(states(server.scope(SERVER_KEY))).toEqual([]);
    expect(states(local.scope(LOCAL_KEY))).toEqual(["shot.png:ready"]);
  });

  it("does not move attachments that a pending send still holds", async () => {
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    const draftId = local.scope(LOCAL_KEY).drafts[0]?.draftId ?? "";
    act(() => {
      local.scope(LOCAL_KEY).holdForSend?.([draftId]);
    });

    expect(local.scope(LOCAL_KEY).releaseForCarry?.()).toBeNull();
    expect(local.released).toEqual([]);
  });

  it("carries a source whose intake had not produced a chip yet", async () => {
    const held = (local.inspectGate = gate());
    let taking: Promise<void> = Promise.resolve();
    act(() => {
      taking = local
        .scope(LOCAL_KEY)
        .add(LOCAL_ROOT, [{ kind: "path", path: "/Users/dev/spec.pdf" }, image()]);
    });
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
    expect(local.scope(LOCAL_KEY).pendingIntake).toBe(true);

    carryToServer();
    await settle(() =>
      expect(states(server.scope(SERVER_KEY))).toEqual(["spec.pdf:ready", "shot.png:ready"]),
    );
    await act(async () => {
      held.open();
      await taking;
    });

    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
    expect(local.scope(LOCAL_KEY).pendingIntake).toBe(false);
    expect(local.staged).toEqual([]);
  });

  it("moves a pending intake with the draft and resumes it only where the draft now lives", async () => {
    const ticket = local.scope(LOCAL_KEY).openIntake?.(LOCAL_ROOT) ?? null;
    expect(ticket).not.toBeNull();
    if (ticket === null) return;
    expect(local.scope(LOCAL_KEY).holdsIntake?.(ticket)).toBe(true);
    expect(local.scope(`new:${LOCAL_ROOT}:other`).holdsIntake?.(ticket)).toBe(false);

    carryToServer();

    expect(local.scope(LOCAL_KEY).holdsIntake?.(ticket)).toBe(false);
    expect(local.scope(LOCAL_KEY).continueIntake?.(ticket, () => true)).toBeNull();
    expect(server.scope(SERVER_KEY).holdsIntake?.(ticket)).toBe(true);
    const resume = server.scope(SERVER_KEY).continueIntake?.(ticket, () => true) ?? null;
    expect(resume).not.toBeNull();
    await act(async () => resume?.([image()]));
    expect(states(server.scope(SERVER_KEY))).toEqual(["shot.png:ready"]);
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
  });

  it("fails a pending intake closed when it is closed, cleared or its owner is replaced", async () => {
    const closed = local.scope(LOCAL_KEY).openIntake?.(LOCAL_ROOT) ?? null;
    const cleared = local.scope(LOCAL_KEY).openIntake?.(LOCAL_ROOT) ?? null;
    expect(closed).not.toBeNull();
    expect(cleared).not.toBeNull();
    if (closed === null || cleared === null) return;

    closeAgentAttachmentIntakeTicket(closed);
    expect(agentAttachmentIntakeTicketIsOpen(closed)).toBe(false);
    expect(local.scope(LOCAL_KEY).continueIntake?.(closed, () => true)).toBeNull();
    carryToServer();
    expect(server.scope(SERVER_KEY).holdsIntake?.(closed)).toBe(false);
    expect(server.scope(SERVER_KEY).holdsIntake?.(cleared)).toBe(true);

    act(() => server.scope(SERVER_KEY).clear());
    expect(server.scope(SERVER_KEY).continueIntake?.(cleared, () => true)).toBeNull();

    const replaced = local.scope(LOCAL_KEY).openIntake?.(LOCAL_ROOT) ?? null;
    expect(replaced).not.toBeNull();
    if (replaced === null) return;
    local.owners.set(LOCAL_ROOT, owner(LOCAL_ROOT, 2));
    expect(local.scope(LOCAL_KEY).holdsIntake?.(replaced)).toBe(false);
    expect(local.scope(LOCAL_KEY).continueIntake?.(replaced, () => true)).toBeNull();
  });

  it("bounds pending intakes per draft and says so", () => {
    const tickets = Array.from({ length: MAX_PENDING_AGENT_ATTACHMENT_INTAKES }, () =>
      local.scope(LOCAL_KEY).openIntake?.(LOCAL_ROOT),
    );
    expect(tickets.every((ticket) => ticket !== null && ticket !== undefined)).toBe(true);
    expect(local.scope(LOCAL_KEY).refusal).toBeNull();

    let overflow: unknown = undefined;
    act(() => {
      overflow = local.scope(LOCAL_KEY).openIntake?.(LOCAL_ROOT);
    });
    expect(overflow).toBeNull();
    expect(local.scope(LOCAL_KEY).refusal).toBe(AGENT_ATTACHMENT_INTAKE_BUSY_REFUSAL);

    const first = tickets[0];
    if (first !== null && first !== undefined) closeAgentAttachmentIntakeTicket(first);
    expect(local.scope(LOCAL_KEY).openIntake?.(LOCAL_ROOT)).not.toBeNull();
  });

  it("carries an attachment that already failed as its notice without retrying it", async () => {
    local.stageError = new Error("disk full");
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    const failure = `${AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX}disk full`;
    expect(local.scope(LOCAL_KEY).drafts).toMatchObject([{ state: "failed", failure }]);

    carryToServer();

    expect(server.scope(SERVER_KEY).drafts).toMatchObject([
      { name: "shot.png", state: "failed", failure },
    ]);
    expect(server.gateway.stageAgentAttachmentBytes).not.toHaveBeenCalled();
    expect(states(local.scope(LOCAL_KEY))).toEqual([]);
  });

  it("bounds the bytes retained for attachments the destination could not take", async () => {
    const large = 30 * 1024 * 1024;
    const held = (local.stageGate = gate());
    const first = { ...image("first.png"), bytes: new ArrayBuffer(large) };
    const second = { ...image("second.png"), bytes: new ArrayBuffer(large) };
    let taking: Promise<unknown> = Promise.resolve();
    act(() => {
      taking = Promise.all([
        local.scope(LOCAL_KEY).add(LOCAL_ROOT, [first]),
        local.scope(LOCAL_KEY).add(LOCAL_ROOT, [second]),
      ]);
    });
    await settle(() =>
      expect(states(local.scope(LOCAL_KEY))).toEqual(["first.png:staging", "second.png:staging"]),
    );
    server.stageError = new Error("server refused");

    carryToServer();
    await settle(() =>
      expect(states(server.scope(SERVER_KEY))).toEqual(["first.png:failed", "second.png:failed"]),
    );
    await act(async () => {
      held.open();
      await taking;
    });
    local.stageGate = null;

    carryToLocal();
    await settle(() =>
      expect(states(local.scope(LOCAL_KEY))).toEqual(["first.png:ready", "second.png:failed"]),
    );
    expect(local.scope(LOCAL_KEY).drafts[1]?.failure).toBe(
      `${AGENT_ATTACHMENT_STAGE_FAILURE_PREFIX}server refused`,
    );
  });

  it("carries a failure notice that has no source and bounds its text", async () => {
    const carry = issueAgentAttachmentCarry([
      { name: "broken.png", failure: "x".repeat(1_000), source: null },
    ]);
    act(() => {
      server.scope(SERVER_KEY).acceptCarry?.(SERVER_ROOT, () => carry);
    });

    const failed = server.scope(SERVER_KEY).drafts[0];
    expect(failed).toMatchObject({ name: "broken.png", state: "failed" });
    expect(failed?.failure).toHaveLength(MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS);
  });
});

describe("boundedAgentAttachmentCarryFailure", () => {
  it("keeps short reasons and never splits a surrogate pair when truncating", () => {
    expect(boundedAgentAttachmentCarryFailure("Path is not attachable.")).toBe(
      "Path is not attachable.",
    );
    const padded = `${"x".repeat(MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS - 2)}\u{1F600}tail`;
    const bounded = boundedAgentAttachmentCarryFailure(padded);
    expect(bounded).toBe(`${"x".repeat(MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS - 2)}…`);
    expect(bounded.length).toBeLessThanOrEqual(MAX_AGENT_ATTACHMENT_CARRY_FAILURE_CHARS);
  });
});

describe("attachment carry tokens", () => {
  it("can be redeemed exactly once", () => {
    const carry = issueAgentAttachmentCarry([{ name: "a.png", failure: "gone", source: null }]);
    expect(carry).toEqual({ count: 1 });
    expect(redeemAgentAttachmentCarry(carry).items).toHaveLength(1);
    expect(redeemAgentAttachmentCarry(carry)).toEqual({ items: [], tickets: [] });
  });

  it("issues nothing for an empty draft and redeems nothing from a forged token", () => {
    expect(issueAgentAttachmentCarry([])).toBeNull();
    expect(redeemAgentAttachmentCarry(null)).toEqual({ items: [], tickets: [] });
    expect(redeemAgentAttachmentCarry({ count: 3 })).toEqual({ items: [], tickets: [] });
  });
});

describe("AGENT_ATTACHMENTS_DISCARDED_NOTICE", () => {
  it("still reports attachments discarded by an owner generation change", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const local = mountMachine("local", LOCAL_ROOT);
    await act(() => local.scope(LOCAL_KEY).add(LOCAL_ROOT, [image()]));
    local.owners.set(LOCAL_ROOT, owner(LOCAL_ROOT, 2));
    await act(async () => {
      expect(await local.scope(LOCAL_KEY).prepareTurn(LOCAL_ROOT)).toBeNull();
    });
    expect(local.scope(LOCAL_KEY).drafts).toEqual([]);
    expect(local.scope(LOCAL_KEY).refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(local.scope(LOCAL_KEY).releaseForCarry?.()).toBeNull();
    local.unmount();
  });
});
