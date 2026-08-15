import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/proxy-image")({
    server: {
        handlers: {
            GET: async ({ request }) => {
                const urlObj = new URL(request.url);
                const targetUrl = urlObj.searchParams.get("url");
                if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
                    return new Response("Invalid URL", { status: 400 });
                }

                try {
                    const resp = await fetch(targetUrl, {
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                        }
                    });
                    if (!resp.ok) {
                        return new Response(`Fetch failed: ${resp.status}`, { status: resp.status });
                    }

                    const blob = await resp.blob();
                    const headers = new Headers();
                    headers.set("Content-Type", resp.headers.get("Content-Type") || "image/jpeg");
                    headers.set("Access-Control-Allow-Origin", "*");
                    headers.set("Cache-Control", "public, max-age=31536000");

                    return new Response(blob, {
                        status: 200,
                        headers,
                    });
                } catch (err) {
                    return new Response(`Proxy error: ${err}`, { status: 500 });
                }
            },
        },
    },
});
