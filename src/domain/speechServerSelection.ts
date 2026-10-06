export const SPEECH_MAX_SERVER_CANDIDATES = 32;

export type SpeechServerCandidate = Readonly<{
  serverId: string;
  connected: boolean;
  speechTranscription: boolean;
}>;
export type SpeechServerSelectionInput = Readonly<{
  threadServerId: string | null;
  candidates: readonly SpeechServerCandidate[];
}>;

export function speechServerPreference(input: SpeechServerSelectionInput): readonly string[] {
  const fallbacks = input.candidates
    .slice(0, SPEECH_MAX_SERVER_CANDIDATES)
    .filter(isSpeechCapable)
    .map((candidate) => candidate.serverId);
  const own = input.candidates.find((candidate) => candidate.serverId === input.threadServerId);
  if (own === undefined || !isSpeechCapable(own)) return fallbacks;
  return [own.serverId, ...fallbacks.filter((serverId) => serverId !== own.serverId)];
}

function isSpeechCapable(candidate: SpeechServerCandidate): boolean {
  return candidate.connected && candidate.speechTranscription;
}
