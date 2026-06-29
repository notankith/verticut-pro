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

    const startAnchor = searchWords.slice(0, 2);
    const endAnchor = searchWords.slice(-2);
    
    let matchFound = false;
    let i = transcriptPointer;

    while (i < normTranscript.length) {
      let startMatchIdx = -1;
      
      if (startAnchor.length === 1) {
        if (normTranscript[i].norm === startAnchor[0]) {
          startMatchIdx = i;
        }
      } else if (startAnchor.length >= 2) {
        if (i + 1 < normTranscript.length && 
            normTranscript[i].norm === startAnchor[0] && 
            normTranscript[i + 1].norm === startAnchor[1]) {
          startMatchIdx = i;
        }
      }

      if (startMatchIdx !== -1) {
        let endMatchIdx = -1;
        
        if (searchWords.length <= 2) {
          endMatchIdx = startMatchIdx + searchWords.length - 1;
        } else {
          // Limit forward search to prevent matching across the entire video
          const searchLimit = Math.min(normTranscript.length, startMatchIdx + searchWords.length + 30);
          
          for (let j = startMatchIdx + 1; j < searchLimit; j++) {
            if (endAnchor.length === 1) {
               if (normTranscript[j].norm === endAnchor[0]) {
                 endMatchIdx = j;
                 break;
               }
            } else if (endAnchor.length >= 2) {
               if (j + 1 < searchLimit &&
                   normTranscript[j].norm === endAnchor[0] &&
                   normTranscript[j + 1].norm === endAnchor[1]) {
                 endMatchIdx = j + 1; 
                 break;
               }
            }
          }
        }

        if (endMatchIdx !== -1) {
          results.push({
            link: pair.link,
            start: normTranscript[startMatchIdx].start,
            end: normTranscript[endMatchIdx].end,
            originalText: pair.text
          });
          transcriptPointer = endMatchIdx + 1;
          matchFound = true;
          break;
        }
      }
      
      i++;
    }

    if (!matchFound) {
      console.warn(`Failed to find match for sourcing text: "${pair.text}"`);
    }
  }

  results.sort((a, b) => a.start - b.start);
  return results;
}
