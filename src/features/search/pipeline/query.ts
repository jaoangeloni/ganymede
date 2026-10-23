import { keywords } from "./text";

const NEGATION = /(^|\s)(?:mas\s+)?(?:sem|não|nao|nada\s+de|nunca|without|but\s+not|not|never)\s/iu;
const NEGATION_EN = /(^|\s)(?:without|but\s+not|not|never|no)\s/iu;
const PORTUGUESE = /(^|\s)(de|da|do|das|dos|com|uma|um|em|para|que|sem|não|nao)(\s|$)/iu;

export interface PromptReading {
  query: string;
  avoid: string[];
}

export function readPrompt(prompt: string): PromptReading {
  const negation = PORTUGUESE.test(prompt) ? NEGATION : NEGATION_EN;
  const kept: string[] = [];
  const avoid: string[] = [];
  for (const part of prompt.split(/(?<=[,;.\n])/)) {
    const match = negation.exec(part);
    kept.push(match ? part.slice(0, match.index) : part);
    if (match) avoid.push(...keywords(part.slice(match.index + match[0].length)));
  }
  return {
    query: kept
      .join("")
      .replace(/\s+/g, " ")
      .replace(/^[\s,;.]+|[\s,;]+$/g, ""),
    avoid: [...new Set(avoid.map((word) => word.toLowerCase()))],
  };
}
