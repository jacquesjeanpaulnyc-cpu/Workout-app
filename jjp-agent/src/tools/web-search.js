/**
 * Web Search Tool — Brave Search API (primary) with DuckDuckGo fallback
 * Returns real URLs, titles, and snippets.
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

function fetchUrl(url, options = {}) {
  return undiciFetch(url, { ...options, ...(dispatcher ? { dispatcher } : {}) });
}

export const definition = {
  name: "web_search",
  description: "Search the web for current information, articles, news, trends, LinkedIn profiles, job listings, guides. Returns real URLs and snippets. Use for any question that needs live web data.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query. Be specific."
      },
      max_results: {
        type: "number",
        description: "How many results to return. Default 8, max 20."
      }
    },
    required: ["query"]
  }
};

export async function execute({ query, max_results }) {
  const limit = Math.min(max_results || 8, 20);
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  // Primary: Brave Search API
  if (braveKey) {
    try {
      const results = await braveSearch(query, limit, braveKey);
      if (results.length > 0) return { query, count: results.length, results };
    } catch (err) {
      console.error("[SEARCH] Brave failed:", err.message);
    }
  }

  // Fallback: DuckDuckGo Instant Answer API
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetchUrl(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`);
    const data = await res.json();

    if (data.Abstract) {
      return { query, source: data.AbstractSource, url: data.AbstractURL, summary: data.Abstract.slice(0, 500) };
    }
    if (data.RelatedTopics?.length) {
      return {
        query,
        results: data.RelatedTopics.slice(0, limit).map(t => ({
          title: (t.Text || "").slice(0, 100),
          url: t.FirstURL || "",
          snippet: (t.Text || "").slice(0, 200)
        }))
      };
    }
  } catch {}

  return { query, note: `No results found for "${query}". Answer from your own knowledge.` };
}

async function braveSearch(query, count, apiKey) {
  const encoded = encodeURIComponent(query);
  const res = await fetchUrl(
    `https://api.search.brave.com/res/v1/web/search?q=${encoded}&count=${count}`,
    {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey
      }
    }
  );

  if (!res.ok) throw new Error(`Brave API ${res.status}`);
  const data = await res.json();
  const webResults = data.web?.results || [];

  return webResults.map(r => ({
    title: r.title || "",
    url: r.url || "",
    snippet: (r.description || "").slice(0, 300)
  }));
}
