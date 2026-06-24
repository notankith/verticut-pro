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
  let lastMatchIndex = 0;

  for (const pair of pairs) {
    const searchWords = normalize(pair.text).split(' ').filter(Boolean);
    if (searchWords.length === 0) continue;

    let bestScore = -1;
    let bestStartIdx = -1;
    let bestEndIdx = -1;

    for (let i = lastMatchIndex; i < normTranscript.length; i++) {
      let score = 0;
      let sIdx = 0;
      let tIdx = i;
      let lastMatchedTIdx = i;

      while (sIdx < searchWords.length && tIdx < normTranscript.length) {
        // Don't let it drift too far
        if (tIdx - i > searchWords.length * 3) break;

        const sWord = searchWords[sIdx];
        const tWord = normTranscript[tIdx].norm;

        if (sWord === tWord) {
          score += 2;
          lastMatchedTIdx = tIdx;
          sIdx++;
          tIdx++;
        } else if (tWord.includes(sWord) || sWord.includes(tWord)) {
          score += 1;
          lastMatchedTIdx = tIdx;
          sIdx++;
          tIdx++;
        } else {
          // Mismatch: try lookahead
          let foundT = -1;
          for (let k = 1; k <= 3 && tIdx + k < normTranscript.length; k++) {
            const lookT = normTranscript[tIdx + k].norm;
            if (lookT === sWord || lookT.includes(sWord) || sWord.includes(lookT)) {
              foundT = k;
              break;
            }
          }

          let foundS = -1;
          for (let k = 1; k <= 3 && sIdx + k < searchWords.length; k++) {
            const lookS = searchWords[sIdx + k];
            if (tWord === lookS || tWord.includes(lookS) || lookS.includes(tWord)) {
              foundS = k;
              break;
            }
          }

          if (foundT !== -1 && (foundS === -1 || foundT <= foundS)) {
            tIdx += foundT; // skip ahead in transcript
          } else if (foundS !== -1) {
            sIdx += foundS; // skip ahead in search
          } else {
            // Neither found, advance both
            sIdx++;
            tIdx++;
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestStartIdx = i;
        bestEndIdx = lastMatchedTIdx; // Use the exact index of the last matched word
      }
    }

    // We consider it a match if it got at least some decent score (e.g., matched at least 1 word perfectly or 2 partially)
    if (bestScore >= 2 && bestStartIdx !== -1) {
      results.push({
        link: pair.link,
        start: transcript[bestStartIdx].start,
        end: transcript[bestEndIdx].end,
        originalText: pair.text
      });
      // Advance so next search starts after this match
      lastMatchIndex = bestEndIdx + 1;
    }
  }

  results.sort((a, b) => a.start - b.start);
  return results;
}
