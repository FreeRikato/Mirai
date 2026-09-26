export function pageScore(value: string, search: string, keywords: readonly string[] = []): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const name = value.toLowerCase();
  const hay = [name, ...keywords.map(k => k.toLowerCase())].join(" ");
  if (!words.every(w => hay.includes(w))) return 0;
  if (name.includes(words.join(" "))) return 1;
  return words.every(w => name.includes(w)) ? 0.8 : 0.5;
}
