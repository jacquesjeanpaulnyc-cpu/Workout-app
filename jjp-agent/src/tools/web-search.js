/**
 * Web Search Tool — Multi-source search with real URLs
 * Uses DuckDuckGo HTML scraping to get actual article links.
 */

import { fetch as undiciFetch, ProxyAgent } from "undici";

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

function fetchUrl(url, options = {}) {
  return undiciFetch(url, { ...options, ...(dispatcher ? { dispatcher } : {}) });
}

export const definition = {
  name: "web_search",
  description: "Search the web for current information, articles, news, trends, guides. Returns real URLs and snippets. Use for any question that needs live web data: AI news, trends, articles, tutorials, prices, current events. Returns up to 8 results with title, URL, and snippet.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query. Be specific — include year, topic, and type (e.g. 'AI agent tutorials 2026', 'Claude API best practices article')"
      },
      max_results: {
        type: "number",
        description: "How many results to return. Default 8, max 15."
      }
    },
    required: ["query"]
  }
};

export async function execute({ query, max_results }) {
  const limit = Math.min(max_results || 8, 15);

  try {
    const encoded = encodeURIComponent(query);

    // Try DuckDuckGo HTML search — gives real URLs
    const htmlRes = await fetchUrl(
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      }
    );

    const html = await htmlRes.text();
    const results = parseSearchResults(html, limit);

    if (results.length > 0) {
      return {
        query,
        count: results.length,
        results
      };
    }

    // Fallback — DuckDuckGo instant answer API
    const apiRes = await fetchUrl(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
    );
    const data = await apiRes.json();

    if (data.Abstract) {
      return {
        query,
        source: data.AbstractSource,
        url: data.AbstractURL,
        summary: data.Abstract.slice(0, 500)
      };
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

    return { query, note: `No web results found for "${query}". Try rephrasing or answer from your knowledge.` };
  } catch (err) {
    return { query, error: `Search unavailable: ${err.message}` };
  }
}

/**
 * Parse DuckDuckGo HTML results page
 */
function parseSearchResults(html, limit) {
  const results = [];

  // Match result blocks: <a class="result__a" href="URL">TITLE</a>
  // Then the snippet: <a class="result__snippet" ...>SNIPPET</a>
  const resultBlockRegex = /<div class="result results_links[^"]*"[\s\S]*?<\/div>\s*<\/div>/g;
  const blocks = html.match(resultBlockRegex) || [];

  for (const block of blocks) {
    if (results.length >= limit) break;

    // Extract title and URL
    const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!linkMatch) continue;

    // DuckDuckGo uses redirect URLs like //duckduckgo.com/l/?uddg=ENCODED_URL
    let url = linkMatch[1];
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
    if (url.startsWith("//")) url = "https:" + url;

    const title = linkMatch[2].replace(/<[^>]*>/g, "").trim().slice(0, 150);

    // Extract snippet
    const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippet = snippetMatch
      ? snippetMatch[1].replace(/<[^>]*>/g, "").trim().slice(0, 300)
      : "";

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}
