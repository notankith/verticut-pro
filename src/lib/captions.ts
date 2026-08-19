export type TranscriptWord = {
  text: string;
  start: number;
  end: number;
};

export type CaptionSegment = {
  words: TranscriptWord[];
  lines: TranscriptWord[][];
  text: string;
  start: number;
  end: number;
  wordStartIndex: number;
};

function makeSegment(lines: TranscriptWord[][], wordStartIndex: number): CaptionSegment {
  const words = lines.flat();
  return {
    words,
    lines,
    text: lines.map((line) => line.map((x) => x.text).join(" ")).join("\n"),
    start: words[0].start,
    end: words[words.length - 1].end,
    wordStartIndex,
  };
}

/** Same grouping rules the caption overlay uses (words/line, lines/segment, punctuation). */
export function buildCaptionSegments(
  transcript: TranscriptWord[] | undefined | null,
  captionWordsPerLine = 3,
  captionLinesPerSegment = 1,
): CaptionSegment[] {
  if (!transcript || transcript.length === 0) return [];

  const segments: CaptionSegment[] = [];
  let currentLine: TranscriptWord[] = [];
  let currentSegmentLines: TranscriptWord[][] = [];
  let segmentStartIndex = 0;

  for (let i = 0; i < transcript.length; i++) {
    const w = transcript[i];
    if (currentLine.length === 0 && currentSegmentLines.length === 0) {
      segmentStartIndex = i;
    }
    currentLine.push(w);

    const text = w.text.trim();
    const hasPunctuation = /[.!?,]$/.test(text);

    if (currentLine.length >= captionWordsPerLine || hasPunctuation) {
      currentSegmentLines.push(currentLine);
      currentLine = [];

      if (currentSegmentLines.length >= captionLinesPerSegment || hasPunctuation) {
        segments.push(makeSegment(currentSegmentLines, segmentStartIndex));
        currentSegmentLines = [];
      }
    }
  }
  if (currentLine.length > 0) {
    currentSegmentLines.push(currentLine);
  }
  if (currentSegmentLines.length > 0) {
    segments.push(makeSegment(currentSegmentLines, segmentStartIndex));
  }
  return segments;
}

export function applyWordText(
  transcript: TranscriptWord[],
  wordIndex: number,
  text: string,
): TranscriptWord[] {
  if (wordIndex < 0 || wordIndex >= transcript.length) return transcript;
  if (transcript[wordIndex].text === text) return transcript;
  return transcript.map((w, i) => (i === wordIndex ? { ...w, text } : w));
}

/** Case-insensitive whole-word replace, keeping trailing punctuation on the original token. */
export function replaceTranscriptWords(
  transcript: TranscriptWord[],
  find: string,
  replaceWith: string,
): TranscriptWord[] {
  const needle = find.trim().toLowerCase();
  if (!needle) return transcript;
  return transcript.map((w) => {
    const stripped = w.text.replace(/([.!?,]+)$/, "");
    const punct = w.text.slice(stripped.length);
    if (stripped.toLowerCase() === needle) {
      return { ...w, text: replaceWith + punct };
    }
    return w;
  });
}

export function getSourceTime(
  audioSegments: { projStart: number; duration: number; srcStart: number }[],
  t: number,
): number {
  for (const s of audioSegments) {
    if (t >= s.projStart && t < s.projStart + s.duration) {
      return s.srcStart + (t - s.projStart);
    }
  }
  return -1;
}

export function getProjTime(
  audioSegments: { projStart: number; duration: number; srcStart: number }[],
  sourceTime: number,
): number {
  for (const s of audioSegments) {
    if (sourceTime >= s.srcStart && sourceTime < s.srcStart + s.duration) {
      return s.projStart + (sourceTime - s.srcStart);
    }
  }
  return sourceTime;
}

export function fmtCaptionTime(t: number): string {
  const m = Math.floor(Math.max(0, t) / 60);
  const s = Math.floor(Math.max(0, t) % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
