import { createFileRoute } from "@tanstack/react-router";

const SPORTSKEEDA_SEARCH_URL = "https://a-gotham.sportskeeda.com/social-media-bank/search";
const FW_ID = "5794690";
const FW_SECRET = "$2y$10$YyrVPEAtxGT1T5FRh4G2XezTegYFwEvCHcV5NPkekdx1qfhA1aAsi";

type SearchRequest = {
  query: string;
  page?: number;
  size?: number;
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
          imageProvider: "getty",
          images,
          raw: parsed,
        });
      },
    },
  },
});

