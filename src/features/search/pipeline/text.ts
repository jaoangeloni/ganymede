import type { Reference } from "../../../types";

const STOPWORDS = new Set(
  `a o as os um uma uns umas de da do das dos em no na nos nas por para com sem que e ou se ao aos
   the an and or of in on at to for with from by is are this that into over under
   la le les el los del der die das und von con las una uno est como mais muito sobre entre seu sua pela pelo
   estao sao foi ser ver tudo todo toda aqui onde quando sai ideias ideas dicas tips your you how what more most about
   parecer parece parecendo look looking like imagens imagen papel parede
   img dsc dscn jpg jpeg png photo foto image imagem file picture www com net org html`.split(/\s+/),
);

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export function keywords(text: string): string[] {
  return text.split(/[^\p{L}\p{N}-]+/u).filter((word) => word.length > 2 && !STOPWORDS.has(fold(word)));
}

export function tokenize(text: string): string[] {
  return fold(text)
    .split(/[^a-z]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .map((token) => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token));
}

export function referenceTokens(ref: Reference): Set<string> {
  return new Set(tokenize([ref.title, ref.alt].filter(Boolean).join(" ")));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / (a.size + b.size - shared);
}
