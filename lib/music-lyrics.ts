export type LyricLine = { time: number; text: string };
export function parseLyrics(lrc: string): LyricLine[] {
  return lrc
    .split(/\r?\n/)
    .flatMap((line) => {
      const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      const text = line.replace(/\[[^\]]*\]/g, "").trim();
      return text
        ? stamps.map((match) => ({
            time: Number(match[1]) * 60 + Number(match[2]),
            text,
          }))
        : [];
    })
    .sort((a, b) => a.time - b.time);
}
export function activeLyric(lines: LyricLine[], position: number) {
  return lines.findLastIndex((line) => line.time <= position);
}
