const OBJECTIONABLE_TERMS = [
  /\b(?:kill|kys|murder)\b/i,
  /\b(?:rape|rapist)\b/i,
  /\b(?:child porn|csam)\b/i,
  /\b(?:nazi|terrorist)\b/i,
];

export function containsObjectionableContent(value: string): boolean {
  const normalized = value.replace(/[\u0000-\u001f]/g, " ").trim();
  return OBJECTIONABLE_TERMS.some((term) => term.test(normalized));
}
