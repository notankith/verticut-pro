export interface SourcingPair {
  text: string;
  link: string | null;
}

export interface MatchedSourcing {
  link: string | null;
  start: number;
  end: number;
  originalText: string;
}

/**
 * Parses raw JSON text into pairs of [text, link]
 */
export function parseSourcingText(input: string): SourcingPair[] {
  try {
    const data = JSON.parse(input);
    if (!Array.isArray(data)) return [];
    
    return data.map((item: any) => ({
      text: String(item.text || ""),
      link: item.image || null,
    }));
  } catch (err) {
    console.error("Failed to parse sourcing JSON", err);
    return [];
  }
}

function normalize(str: string) {
  return str.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Matches sourcing text to the closest transcript words, enforcing sequential order.
 */
export function matchSourcingToTranscript(
  pairs: SourcingPair[], 
  transcript: {text: string, start: number, end: number}[],
  projectDuration: number
): MatchedSourcing[] {
  if (transcript.length === 0) return [];

  const normTranscript = transcript.map(t => ({
    ...t,
    norm: normalize(t.text)
  })).filter(t => t.norm.length > 0);

  const results: MatchedSourcing[] = [];
  let transcriptPointer = 0;

  for (const pair of pairs) {
    const searchWords = normalize(pair.text).split(' ').filter(Boolean);
    if (searchWords.length === 0) {
      console.warn(`Skipping empty sourcing text: "${pair.text}"`);
      continue;
    }
    // Try to find a contiguous or near-contiguous match of the search words
    let matchFound = false;
    const maxExtraWindow = 30; // allow some slack for longer phrases
    const maxGapPerWord = 3; // allow small gaps between words when necessary

    for (let i = transcriptPointer; i < normTranscript.length && !matchFound; i++) {
      if (normTranscript[i].norm !== searchWords[0]) continue;

      // Attempt to match subsequent words allowing small gaps
      let lastIdx = i;
      let matched = 1;
      let j = i + 1;
      const windowLimit = Math.min(normTranscript.length, i + searchWords.length + maxExtraWindow);

      while (matched < searchWords.length && j < windowLimit) {
        if (normTranscript[j].norm === searchWords[matched]) {
          lastIdx = j;
          matched++;
          j++;
        } else {
          // allow skipping a few non-matching words
          let k = j + 1;
          let foundAhead = -1;
          while (k < Math.min(windowLimit, j + maxGapPerWord + 1)) {
            if (normTranscript[k].norm === searchWords[matched]) { foundAhead = k; break; }
            k++;
          }
          if (foundAhead !== -1) {
            lastIdx = foundAhead;
            matched++;
            j = foundAhead + 1;
          } else {
            j++;
          }
        }
      }

      if (matched === searchWords.length) {
        results.push({
          link: pair.link,
          start: normTranscript[i].start,
          end: normTranscript[lastIdx].end,
          originalText: pair.text,
        });
        transcriptPointer = lastIdx + 1;
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      // As a fallback, try a loose substring search on the joined normalized transcript
      const joined = normTranscript.map((t) => t.norm).join(' ');
      const needle = searchWords.join(' ');
      const idx = joined.indexOf(needle);
      if (idx !== -1) {
        // Map character index back to word indices
        let charCursor = 0;
        let startWord = -1;
        let endWord = -1;
        for (let w = 0; w < normTranscript.length; w++) {
          const token = normTranscript[w].norm;
          if (charCursor === idx) startWord = w;
          charCursor += token.length + 1; // token + space
          if (charCursor > idx && startWord === -1) startWord = w; // fallback
          if (charCursor >= idx + needle.length) { endWord = w; break; }
        }
        if (startWord !== -1 && endWord === -1) endWord = normTranscript.length - 1;
        if (startWord !== -1 && endWord !== -1) {
          results.push({ link: pair.link, start: normTranscript[startWord].start, end: normTranscript[endWord].end, originalText: pair.text });
          transcriptPointer = endWord + 1;
          matchFound = true;
        }
      }

      if (!matchFound) {
        console.warn(`Failed to find match for sourcing text: "${pair.text}"`);
      }
    }
  }

  results.sort((a, b) => a.start - b.start);
  return results;
}
