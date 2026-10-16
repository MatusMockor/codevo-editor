export interface WorkspaceRequestTokenRegistry {
  readonly hasPending: () => boolean;
}

export class LatestWorkspaceRequestTokenRegistry implements WorkspaceRequestTokenRegistry {
  private currentToken: number | null = null;

  issue(token: number): void {
    this.currentToken = token;
  }

  complete(token: number): void {
    if (this.currentToken === token) {
      this.currentToken = null;
    }
  }

  retire(): void {
    this.currentToken = null;
  }

  hasPending(): boolean {
    return this.currentToken !== null;
  }

  pendingToken(): number | null {
    return this.currentToken;
  }
}
