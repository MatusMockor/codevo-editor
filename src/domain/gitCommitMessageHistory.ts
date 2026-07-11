export const MAX_GIT_COMMIT_MESSAGE_HISTORY = 20;
export const MAX_GIT_COMMIT_MESSAGE_LENGTH = 4000;

function normalizeGitCommitMessage(message: string): string {
  return message.trim().slice(0, MAX_GIT_COMMIT_MESSAGE_LENGTH);
}

export function pushGitCommitMessageHistory(
  history: string[],
  message: string,
): string[] {
  const normalizedMessage = normalizeGitCommitMessage(message);

  if (!normalizedMessage) {
    return history;
  }

  return [
    normalizedMessage,
    ...history.filter((entry) => entry !== normalizedMessage),
  ].slice(0, MAX_GIT_COMMIT_MESSAGE_HISTORY);
}

export function normalizeGitCommitMessageHistory(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<string[]>((history, entry) => {
    if (typeof entry !== "string") {
      return history;
    }

    const normalizedEntry = normalizeGitCommitMessage(entry);
    if (!normalizedEntry || history.includes(normalizedEntry)) {
      return history;
    }

    if (history.length >= MAX_GIT_COMMIT_MESSAGE_HISTORY) {
      return history;
    }

    history.push(normalizedEntry);
    return history;
  }, []);
}
