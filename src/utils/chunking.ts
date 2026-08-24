export function chunkText(text: string, chunkSize = 180, overlap = 30): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const step = Math.max(1, chunkSize - overlap);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    const piece = words.slice(i, i + chunkSize).join(' ').trim();
    if (piece) chunks.push(piece);
    if (i + chunkSize >= words.length) break;
  }
  return chunks;
}
