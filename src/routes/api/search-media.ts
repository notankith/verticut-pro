import { createFileRoute } from "@tanstack/react-router";
// @ts-ignore
import ddg from "duckduckgo-images-api";

const SPORTSKEEDA_SEARCH_URL = "https://a-gotham.sportskeeda.com/social-media-bank/search";
const FW_ID = "5794690";
const FW_SECRET = "$2y$10$YyrVPEAtxGT1T5FRh4G2XezTegYFwEvCHcV5NPkekdx1qfhA1aAsi";

type SearchRequest = {
  query: string;
  page?: number;
  size?: number;
  source?: "verticut" | "duckduckgo" | "giphy" | "pexels";
};

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

type ParsedImage = {
  url: string;
  title?: string;
};

function collectSearchImages(node: unknown, images: Map<string, ParsedImage>) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectSearchImages(item, images);
    return;
  }
  if (typeof node !== "object") return;

  const obj = node as Record<string, unknown>;
  const urlCandidates = [
    obj.image_url,
    obj.imageUrl,
    obj.url,
    obj.image,
    obj.thumbnail,
    obj.thumbnailUrl,
    obj.previewUrl,
    obj.src,
    obj.sourceUrl,
  ];
  const url = urlCandidates.find((candidate) => typeof candidate === "string" && /^https?:\/\//i.test(candidate)) as string | undefined;

  if (url) {
    const title =
      typeof obj.image_title === "string"
        ? obj.image_title
        : typeof obj.title === "string"
          ? obj.title
          : typeof obj.image_caption === "string"
            ? obj.image_caption
            : undefined;

    if (!images.has(url)) {
      images.set(url, { url, title });
    }
  }

  for (const value of Object.values(obj)) {
    collectSearchImages(value, images);
  }
}

// Fallback search fetcher for DuckDuckGo
async function queryDuckDuckGoImages(keywords: string) {
  const htmlUrl = `https://duckduckgo.com/?q=${encodeURIComponent(keywords)}`;
  const htmlRes = await fetch(htmlUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  const html = await htmlRes.text();
  const vqdMatch = html.match(/vqd=([0-9-]+)/) || html.match(/vqd=["']([0-9-]+)["']/);
  if (!vqdMatch) {
    throw new Error("Could not extract vqd token from DuckDuckGo");
  }
  const vqd = vqdMatch[1];

  const jsonUrl = `https://duckduckgo.com/i.js?o=json&q=${encodeURIComponent(keywords)}&vqd=${vqd}&f=,,,`;
  const jsonRes = await fetch(jsonUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/json",
      "Referer": "https://duckduckgo.com/"
    }
  });
  if (!jsonRes.ok) {
    throw new Error(`DuckDuckGo image search failed with HTTP ${jsonRes.status}`);
  }
  const data = await jsonRes.json();
  if (!data?.results) return [];

  return data.results.map((r: any) => ({
    id: r.image || r.thumbnail,
    url: r.image || r.thumbnail,
    title: r.title || ""
  }));
}

async function queryGiphy(keywords: string) {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) {
    throw new Error("GIPHY_API_KEY is not configured");
  }
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(keywords)}&limit=50`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Giphy API request failed with status ${response.status}`);
  }
  const data = await response.json();
  if (!data?.data) return [];
  return data.data.map((g: any) => ({
    id: g.images.original.url,
    url: g.images.original.url,
    title: g.title || "Giphy GIF"
  }));
}

async function queryPexels(keywords: string) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    throw new Error("PEXELS_API_KEY is not configured");
  }
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(keywords)}&per_page=50`;
  const response = await fetch(url, {
    headers: {
      "Authorization": apiKey
    }
  });
  if (!response.ok) {
    throw new Error(`Pexels API request failed with status ${response.status}`);
  }
  const data = await response.json();
  if (!data?.photos) return [];
  return data.photos.map((p: any) => ({
    id: p.src.large,
    url: p.src.large,
    title: p.alt || p.photographer || "Pexels Photo"
  }));
}

export const Route = createFileRoute("/api/search-media")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: SearchRequest;
        try {
          body = (await request.json()) as SearchRequest;
        } catch {
          return new Response(JSON.stringify({ error: "Bad JSON" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const query = String(body?.query || "").trim();
        if (!query) {
          return new Response(JSON.stringify({ error: "query is required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const page = clampInt(body.page, 1, 1, 500);
        const size = clampInt(body.size, 24, 1, 100);
        const source = String(body?.source || "verticut").trim();

        if (source === "duckduckgo") {
          try {
            const results = await queryDuckDuckGoImages(query);

            const images = results.map((r: any) => ({
              id: r.image || r.url || r.thumbnail,
              url: r.image || r.url || r.thumbnail,
              title: r.title || ""
            }));

            return Response.json({
              query,
              page,
              size,
              source,
              images
            });
          } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
        }

        if (source === "giphy") {
          try {
            const images = await queryGiphy(query);
            return Response.json({
              query,
              page,
              size,
              source,
              images
            });
          } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
        }

        if (source === "pexels") {
          try {
            const images = await queryPexels(query);
            return Response.json({
              query,
              page,
              size,
              source,
              images
            });
          } catch (err: any) {
            return new Response(JSON.stringify({ error: err.message }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
        }

        // Default: verticut search (Sportskeeda-Getty)
        const searchUrl = new URL(SPORTSKEEDA_SEARCH_URL);
        searchUrl.searchParams.set("query", query);
        searchUrl.searchParams.set("page", String(page));
        searchUrl.searchParams.set("size", String(size));
        searchUrl.searchParams.set("imageProvider", "getty");

        const response = await fetch(searchUrl.toString(), {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
            Referer: "https://www.sportskeeda.com/",
            Cookie: `fw_ID=${FW_ID}; fw_secret=${FW_SECRET}`,
          },
        });

        const text = await response.text();
        if (!response.ok) {
          return new Response(
            JSON.stringify({
              error: `Sportskeeda request failed (${response.status})`,
              details: text.slice(0, 500),
            }),
            {
              status: response.status,
              headers: { "content-type": "application/json" },
            },
          );
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return new Response(JSON.stringify({ error: "Sportskeeda returned non-JSON payload" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }

        const imageMap = new Map<string, ParsedImage>();
        collectSearchImages(parsed, imageMap);

        const images = Array.from(imageMap.values()).map((image) => ({
          id: image.url,
          url: image.url,
          title: image.title,
        }));

        return Response.json({
          query,
          page,
          size,
          source,
          images,
          raw: parsed,
        });
      },
    },
  },
});

