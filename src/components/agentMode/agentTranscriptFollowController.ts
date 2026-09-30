import {
  AGENT_PINNED_DISTANCE_PX,
  agentDistanceFromBottom,
  agentFollowsAfterScroll,
  agentTranscriptAnchorAt,
  agentTranscriptAnchorDrift,
  selectAgentTranscriptAnchor,
  type AgentTranscriptAnchor,
} from "./agentTranscriptAnchor";

export const AGENT_DISCLOSURE_HOLD_MS = 1_000;
const DISCLOSURE_SELECTOR = "[aria-expanded], summary";
const MIN_SHIFT_PX = 1;

interface DisclosureHold {
  readonly anchor: AgentTranscriptAnchor;
  readonly expiresAtMs: number;
}

export class AgentTranscriptFollowController {
  private following: boolean;
  private anchor: AgentTranscriptAnchor = [];
  private hold: DisclosureHold | null = null;
  private lastTop: number;

  constructor(
    readonly container: HTMLElement,
    following: boolean,
    private readonly onFollowingChange: (following: boolean) => void,
    private readonly now: () => number,
  ) {
    this.following = following;
    this.lastTop = container.scrollTop;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  follow(): boolean {
    this.anchor = [];
    this.hold = null;
    this.setFollowing(true);
    return this.pin();
  }

  followIfFollowing(): boolean {
    if (!this.following) return false;
    return this.pin();
  }

  release(): void {
    this.hold = null;
    this.setFollowing(false);
    this.anchor = selectAgentTranscriptAnchor(this.container);
  }

  handleScroll(): void {
    const top = this.container.scrollTop;
    const movedBy = top - this.lastTop;
    if (movedBy === 0) return;
    this.lastTop = top;
    this.hold = null;
    if (!this.following) this.compensateShiftDuringScroll(movedBy);
    const following = agentFollowsAfterScroll({
      following: this.following,
      movedBy,
      distanceFromBottom: agentDistanceFromBottom(this.container),
    });
    this.setFollowing(following);
    this.anchor = following ? [] : selectAgentTranscriptAnchor(this.container);
  }

  handleWheel(deltaX: number, deltaY: number, target: EventTarget | null): void {
    if (deltaY >= 0 || !this.following) return;
    if (Math.abs(deltaY) <= Math.abs(deltaX)) return;
    if (this.container.scrollHeight <= this.container.clientHeight) return;
    if (this.insideScrolledChild(target)) return;
    this.release();
  }

  handleClick(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    const disclosure = target.closest(DISCLOSURE_SELECTOR);
    if (disclosure === null || !this.container.contains(disclosure)) return;
    const anchor = agentTranscriptAnchorAt(this.container, disclosure);
    if (anchor.length === 0) return;
    if (this.following) {
      this.hold = { anchor, expiresAtMs: this.now() + AGENT_DISCLOSURE_HOLD_MS };
      return;
    }
    this.anchor = anchor;
  }

  handleLayout(): void {
    if (this.container.scrollTop !== this.lastTop) this.handleScroll();
    const hold = this.takeHold();
    if (hold !== null) {
      this.setFollowing(false);
      this.anchor = hold.anchor;
    }
    if (this.following) {
      this.pin();
      return;
    }
    this.restoreAnchor();
    if (hold !== null && agentDistanceFromBottom(this.container) <= AGENT_PINNED_DISTANCE_PX) {
      this.follow();
    }
  }

  private compensateShiftDuringScroll(movedBy: number): void {
    const measured = agentTranscriptAnchorDrift(this.container, this.anchor);
    if (measured === null || Math.abs(measured.drift) < MIN_SHIFT_PX) return;
    const shift = measured.drift + movedBy;
    if (Math.abs(shift) < MIN_SHIFT_PX) return;
    this.scrollTo(this.container.scrollTop + shift);
  }

  private restoreAnchor(): void {
    const measured = agentTranscriptAnchorDrift(this.container, this.anchor);
    if (measured !== null && Math.abs(measured.drift) < 0.5 && !measured.lostDepth) return;
    if (measured !== null && measured.drift !== 0) {
      this.scrollTo(this.container.scrollTop + measured.drift);
    }
    this.anchor = selectAgentTranscriptAnchor(this.container);
  }

  private insideScrolledChild(target: EventTarget | null): boolean {
    let element = target instanceof Element ? target : null;
    while (element !== null && element !== this.container) {
      if (element.scrollTop > 0) return true;
      element = element.parentElement;
    }
    return false;
  }

  private takeHold(): DisclosureHold | null {
    const hold = this.hold;
    this.hold = null;
    if (hold === null || !this.following) return null;
    if (this.now() > hold.expiresAtMs) return null;
    return hold;
  }

  private pin(): boolean {
    const before = this.container.scrollTop;
    this.scrollTo(this.container.scrollHeight);
    return this.container.scrollTop !== before;
  }

  private scrollTo(top: number): void {
    this.container.scrollTop = top;
    this.lastTop = this.container.scrollTop;
  }

  private setFollowing(following: boolean): void {
    if (this.following === following) return;
    this.following = following;
    this.onFollowingChange(following);
  }
}
