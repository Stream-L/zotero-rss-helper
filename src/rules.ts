export interface RssEntryLike {
  title?: string;
  description?: string;
  abstractNote?: string;
  url?: string;
  link?: string;
  DOI?: string;
  doi?: string;
  publisher?: string;
  [key: string]: unknown;
}

export interface RecognitionRule {
  id: string;
  domains: string[];
  extract(entry: RssEntryLike): { doi?: string; url?: string };
}

const DOI = /10\.\d{4,9}\/[\w.()/:;-]+/i;

function cleanDoi(value: string | undefined): string | undefined {
  const match = value?.match(DOI);
  return match?.[0].replace(/[.,;:)]+$/, "").toLowerCase();
}

export const genericRule: RecognitionRule = {
  id: "generic-doi",
  domains: ["*"],
  extract(entry) {
    const text = [entry.DOI, entry.doi, entry.url, entry.link, entry.title, entry.description, entry.abstractNote, entry.extra]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    return { doi: cleanDoi(text), url: entry.url ?? entry.link };
  },
};

const rules: RecognitionRule[] = [genericRule];

export function registerRecognitionRule(rule: RecognitionRule): void {
  if (!rule.id || rules.some((item) => item.id === rule.id)) throw new Error(`Duplicate recognition rule: ${rule.id}`);
  rules.unshift(rule);
}

export function recognize(entry: RssEntryLike): { ruleId: string; doi?: string; url?: string } {
  for (const rule of rules) {
    const result = rule.extract(entry);
    if (result.doi || result.url) return { ruleId: rule.id, ...result };
  }
  return { ruleId: "none" };
}
