import type { RssEntryLike } from "./rules";

export interface CrossrefWork {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  "container-title"?: string[];
  published?: { [key: string]: number[][] | undefined };
  type?: string;
  URL?: string;
  publisher?: string;
  abstract?: string;
}

export interface CrossrefClient {
  request(method: string, url: string, options?: Record<string, unknown>): Promise<{ response: string | object }>;
}

export interface EnrichedMetadata {
  DOI: string;
  title?: string;
  creators?: Array<{ firstName?: string; lastName?: string; creatorType: "author" }>;
  publicationTitle?: string;
  date?: string;
  url?: string;
  publisher?: string;
  abstractNote?: string;
}

export interface AbstractClient extends CrossrefClient {}

function metadataFromWork(work: CrossrefWork): EnrichedMetadata | null {
  if (!work.DOI) return null;
  const dateParts = work.published?.["date-parts"]?.[0];
  return {
    DOI: work.DOI,
    title: work.title?.[0],
    creators: work.author?.map((author) => ({ firstName: author.given, lastName: author.family ?? author.name, creatorType: "author" as const })),
    publicationTitle: work["container-title"]?.[0],
    date: dateParts?.join("-"),
    url: work.URL,
    publisher: work.publisher,
    abstractNote: work.abstract,
  };
}

export async function lookupCrossref(client: CrossrefClient, doi: string): Promise<EnrichedMetadata | null> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const result = await client.request("GET", url, { responseType: "json", timeout: 10000 });
  const body = typeof result.response === "string" ? JSON.parse(result.response) : result.response;
  const work = (body as { message?: CrossrefWork }).message;
  return work ? metadataFromWork(work) : null;
}

export async function lookupCrossrefByBibliographic(client: CrossrefClient, text: string): Promise<EnrichedMetadata | null> {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(text)}&rows=1`;
  const result = await client.request("GET", url, { responseType: "json", timeout: 10000 });
  const body = typeof result.response === "string" ? JSON.parse(result.response) : result.response;
  const work = (body as { message?: { items?: CrossrefWork[] } }).message?.items?.[0];
  return work ? metadataFromWork(work) : null;
}

export async function lookupOpenAlexAbstract(client: AbstractClient, doi: string): Promise<string | undefined> {
  const url = `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`;
  const result = await client.request("GET", url, { responseType: "json", timeout: 10000 });
  const body = typeof result.response === "string" ? JSON.parse(result.response) : result.response;
  const index = (body as { abstract_inverted_index?: Record<string, number[]> }).abstract_inverted_index;
  if (!index) return undefined;
  return Object.entries(index)
    .flatMap(([word, positions]) => positions.map((position) => ({ word, position })))
    .sort((a, b) => a.position - b.position)
    .map(({ word }) => word)
    .join(" ");
}

export function mergeMetadata(original: RssEntryLike, metadata: EnrichedMetadata | null): RssEntryLike {
  if (!metadata) return { ...original };
  return {
    ...original,
    ...metadata,
    abstractNote: metadata.abstractNote ?? original.abstractNote ?? original.description,
  };
}
