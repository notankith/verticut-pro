import { createFileRoute } from "@tanstack/react-router";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers":
        "Content-Length, Content-Type, Content-Range, Accept-Ranges, ETag",
};

function outgoingHeaders(resp: Response): Headers {
    const headers = new Headers(CORS_HEADERS);
    const contentType = resp.headers.get("Content-Type");
    headers.set("Content-Type", contentType || "application/octet-stream");
    const contentLength = resp.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);
    const contentRange = resp.headers.get("Content-Range");
    if (contentRange) headers.set("Content-Range", contentRange);
    headers.set("Accept-Ranges", resp.headers.get("Accept-Ranges") || "bytes");
    const etag = resp.headers.get("ETag");
    if (etag) headers.set("ETag", etag);
    headers.set("Cache-Control", "public, max-age=31536000");
    return headers;
}

async function proxyMedia(request: Request): Promise<Response> {
    const urlObj = new URL(request.url);
    const targetUrl = urlObj.searchParams.get("url");
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
        return new Response("Invalid URL", { status: 400, headers: CORS_HEADERS });
    }

    const method = request.method === "HEAD" ? "HEAD" : "GET";
    const headers: Record<string, string> = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    const range = request.headers.get("Range");
    if (range) headers.Range = range;

    const resp = await fetch(targetUrl, { method, headers });
    if (!resp.ok && resp.status !== 206) {
        return new Response(`Fetch failed: ${resp.status}`, {
            status: resp.status,
            headers: CORS_HEADERS,
        });
    }

    const out = outgoingHeaders(resp);
    if (method === "HEAD") {
        return new Response(null, { status: resp.status, headers: out });
    }
    // Stream the body so large videos don't have to be buffered as a blob
    // (WebCodecs issues Range requests; Remotion/mediabunny needs those).
    return new Response(resp.body, { status: resp.status, headers: out });
}

export const Route = createFileRoute("/api/proxy-image")({
    server: {
        handlers: {
            OPTIONS: async () =>
                new Response(null, { status: 204, headers: CORS_HEADERS }),
            HEAD: async ({ request }) => {
                try {
                    return await proxyMedia(request);
                } catch (err) {
                    return new Response(`Proxy error: ${err}`, {
                        status: 500,
                        headers: CORS_HEADERS,
                    });
                }
            },
            GET: async ({ request }) => {
                try {
                    return await proxyMedia(request);
                } catch (err) {
                    return new Response(`Proxy error: ${err}`, {
                        status: 500,
                        headers: CORS_HEADERS,
                    });
                }
            },
        },
    },
});
