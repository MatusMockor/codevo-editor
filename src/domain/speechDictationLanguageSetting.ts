import { defaultSpeechLanguage, parseSpeechLanguage, type SpeechLanguage } from "./speechDictation";

export type SpeechDictationLanguageSetting = Readonly<{ speechDictationLanguage?: SpeechLanguage }>;

export function normalizeSpeechDictationLanguageSetting(
  value: unknown,
): SpeechDictationLanguageSetting {
  const language = parseSpeechLanguage(value);
  if (language === null) return {};
  return { speechDictationLanguage: language };
}

export function effectiveSpeechDictationLanguage(
  stored: SpeechLanguage | undefined,
  locale: string,
): SpeechLanguage {
  return parseSpeechLanguage(stored) ?? defaultSpeechLanguage(locale);
}
