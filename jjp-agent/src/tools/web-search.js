/**
 * Web Search Tool — DuckDuckGo Instant Answer API
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

function fetchUrl(url, options = {}) {
  return undiciFetch(url, { ...options, ...(dispatcher ? { dispatcher } : {}) });
}

export const definition = {
  name: "web_search",
  description: "Search the web for current information. Use when Jay asks about news, prices, events, or anything requiring live data.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query"
      }
    },
    required: ["query"]
  }
};

export async function execute({ query }) {
  try {
    const encoded = encodeURIComponent(query);
    const res = await fetchUrl(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
    );
    const data = await res.json();

    // Try abstract first (best summary)
    if (data.Abstract) {
      return {
        source: data.AbstractSource,
        url: data.AbstractURL,
        summary: data.Abstract.slice(0, 500)
      };
    }

    // Try related topics
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const top = data.RelatedTopics.slice(0, 3).map(t => ({
        text: t.Text?.slice(0, 200) || "",
        url: t.FirstURL || ""
      }));
      return { results: top };
    }

    // Try answer
    if (data.Answer) {
      return { answer: data.Answer };
    }

    // Fallback — try DuckDuckGo HTML search
    const htmlRes = await fetchUrl(
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      { headers: { "User-Agent": "JJP-Agent/1.0" } }
    );
    const html = await htmlRes.text();
    const snippets = [];
    const regex = /class="result__snippet">(.*?)<\/a>/gs;
    let match;
    while ((match = regex.exec(html)) !== null && snippets.length < 3) {
      const clean = match[1].replace(/<[^>]*>/g, "").trim();
      if (clean) snippets.push(clean.slice(0, 200));
    }

    if (snippets.length > 0) {
      return { results: snippets };
    }

    // If DuckDuckGo returns nothing, give Claude context to answer from knowledge
    return { note: `No web results for "${query}". Answer from your own knowledge.` };
  } catch (err) {
    return { note: `Search unavailable. Answer "${query}" from your own knowledge.` };
  }
}
