import { parseRepoAddress } from "./repo.ts";

interface Collection {
  id: string;
  title: string;
  titles?: Record<string, string>;
  layout: "hero" | "row" | "grid";
  repos: string[];
}

const automaticIds = ["new", "games", "apps", "services", "popular"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFeaturedConfig(raw?: string): Collection[] {
  if (!raw?.trim()) return [];

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("FEATURED_JSON is not valid JSON");
  }
  if (!Array.isArray(value)) throw new Error("FEATURED_JSON must be an array of collections");

  const ids = new Set(automaticIds);
  let hasHero = false;
  const collections = value.map((item: unknown, index): Collection => {
    const context = `FEATURED_JSON collection ${index + 1}`;
    if (!isRecord(item)) throw new Error(`${context} must be an object`);
    const { id, title, titles, layout = "row", repos } = item;
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(`${context} needs a valid id`);
    if (ids.has(id)) throw new Error(`${context} uses a duplicate or reserved id: ${id}`);
    ids.add(id);
    if (typeof title !== "string" || !title.trim()) throw new Error(`${context} needs a title`);
    if (titles !== undefined && (!isRecord(titles) || !Object.values(titles).every((text) => typeof text === "string"))) {
      throw new Error(`${context} titles must map locales to strings`);
    }
    if (layout !== "hero" && layout !== "row" && layout !== "grid") {
      throw new Error(`${context} layout must be hero, row or grid`);
    }
    if (layout === "hero") {
      if (hasHero) throw new Error("FEATURED_JSON allows only one hero collection");
      hasHero = true;
    }
    if (!Array.isArray(repos)) throw new Error(`${context} needs an array of repositories`);
    const keys = repos.map((address: unknown, repoIndex) => {
      const repo = typeof address === "string" ? parseRepoAddress(address) : null;
      if (!repo) throw new Error(`${context} repository ${repoIndex + 1} needs a GitHub repository address`);
      return repo.key;
    });
    return { id, title, titles: titles as Collection["titles"], layout, repos: [...new Set(keys)] };
  });

  if (new TextEncoder().encode(JSON.stringify(collections)).byteLength > 5000) {
    throw new Error("FEATURED_JSON exceeds the 5 KB Worker binding limit after normalization");
  }
  return collections;
}
