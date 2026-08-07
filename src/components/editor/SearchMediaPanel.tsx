import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ImagePlus, Loader2, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type SearchImage = {
  id: string;
  url: string;
  title?: string;
};

type SearchResponse = {
  query: string;
  page: number;
  size: number;
  images: SearchImage[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (imageUrl: string) => Promise<void>;
};

type CacheEntry = {
  images: SearchImage[];
  page: number;
  hasMore: boolean;
};

const DEFAULT_PAGE_SIZE = 24;

export default function SearchMediaPanel({ open, onOpenChange, onImport }: Props) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [source, setSource] = useState<"verticut" | "duckduckgo" | "giphy" | "pexels">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("verticut_search_source");
      if (saved === "verticut" || saved === "duckduckgo" || saved === "giphy" || saved === "pexels") {
        return saved;
      }
    }
    return "verticut";
  });
  const [items, setItems] = useState<SearchImage[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<{ page: number; append: boolean } | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSourceChange = useCallback((val: "verticut" | "duckduckgo" | "giphy" | "pexels") => {
    setSource(val);
    localStorage.setItem("verticut_search_source", val);
  }, []);

  const normalizedQuery = useMemo(() => submittedQuery.trim().toLowerCase(), [submittedQuery]);

  const handleSearchSubmit = useCallback(() => {
    const trimmed = query.trim();
    setSubmittedQuery(trimmed);
  }, [query]);

  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSearchSubmit();
      }
    },
    [handleSearchSubmit],
  );

  const runSearch = useCallback(
    async (nextPage: number, append: boolean) => {
      const q = normalizedQuery;
      if (!q) {
        setItems([]);
        setHasMore(false);
        setError(null);
        setPage(1);
        return;
      }

      const cacheKey = `${q}::${source}::${nextPage}::${size}`;
      const cacheHit = cacheRef.current.get(cacheKey);
      if (cacheHit) {
        setItems((prev) => (append ? [...prev, ...cacheHit.images] : cacheHit.images));
        setPage(cacheHit.page);
        setHasMore(cacheHit.hasMore);
        setError(null);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRetryTarget({ page: nextPage, append });

      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/search-media", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: q,
            page: nextPage,
            size,
            source,
          }),
          signal: controller.signal,
        });

        let data: SearchResponse;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Search failed (${res.status})`);
        }
        data = (await res.json()) as SearchResponse;
        const nextImages = Array.isArray(data.images) ? data.images : [];
        const nextHasMore = nextImages.length >= size;
        cacheRef.current.set(cacheKey, {
          images: nextImages,
          page: data.page ?? nextPage,
          hasMore: nextHasMore,
        });

        setItems((prev) => (append ? [...prev, ...nextImages] : nextImages));
        setPage(data.page ?? nextPage);
        setHasMore(nextHasMore);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [normalizedQuery, size, source],
  );

  useEffect(() => {
    if (!submittedQuery) {
      setItems([]);
      setHasMore(false);
      setError(null);
      setPage(1);
      return;
    }

    void runSearch(1, false);
  }, [submittedQuery, source, runSearch]);

  useEffect(() => {
    if (!open || !hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first.isIntersecting || loading) return;
        void runSearch(page + 1, true);
      },
      { rootMargin: "320px 0px 320px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, hasMore, loading, page, runSearch]);

  const onRetry = useCallback(() => {
    const target = retryTarget ?? { page: 1, append: false };
    void runSearch(target.page, target.append);
  }, [retryTarget, runSearch]);

  return (
    <section className="flex h-full flex-col bg-panel">
      <header className="flex items-center justify-between border-b border-border px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/12 text-primary">
            <Search className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold">Search Media</h3>
            <p className="text-[10px] text-muted-foreground">Search and import stock media</p>
          </div>
        </div>
        <div>
          <select
            value={source}
            onChange={(e) => handleSourceChange(e.target.value as any)}
            className="h-7.5 rounded-md border border-border bg-panel-2 px-2 text-[10px] text-foreground outline-none focus:border-primary/60"
            title="Search provider"
          >
            <option value="verticut">VertiCut Search</option>
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="giphy">Giphy GIFs</option>
            <option value="pexels">Pexels Photos</option>
          </select>
        </div>
      </header>

      <div className="border-b border-border p-3">
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search media..."
              className="h-8.5 w-full rounded-md border border-border bg-panel-2 pl-8.5 pr-2 text-xs outline-none transition-colors focus:border-primary/60"
            />
          </div>
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="h-8.5 rounded-md border border-border bg-panel-2 px-1 text-[10px] text-foreground"
            title="Results per page"
          >
            <option value={12}>12</option>
            <option value={24}>24</option>
            <option value={36}>36</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!normalizedQuery ? (
          <div className="rounded-md border border-dashed border-border bg-panel-2/70 px-3 py-4 text-xs text-muted-foreground">
            Type keyword and hit Enter.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-2 text-[10px] h-7 px-2" onClick={onRetry}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Retry
            </Button>
          </div>
        ) : null}

        {normalizedQuery && !error && items.length === 0 && loading ? (
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[4/5] animate-pulse rounded-md border border-border bg-panel-2" />
            ))}
          </div>
        ) : null}

        {normalizedQuery && !error && !loading && items.length === 0 ? (
          <div className="rounded-md border border-border bg-panel-2/70 p-3 text-xs text-muted-foreground">
            No images found.
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {items.map((item) => {
              const importing = importingId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={async () => {
                    setImportingId(item.id);
                    try {
                      await onImport(item.url);
                    } finally {
                      setImportingId(null);
                    }
                  }}
                  className="group relative overflow-hidden rounded-md border border-border bg-panel-2 text-left transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  title="Import image to timeline"
                >
                  <img
                    src={item.url}
                    alt={item.title ?? "Media image"}
                    loading="lazy"
                    className="aspect-[4/5] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1.5 pt-3">
                    <div className="flex items-center justify-between gap-1 text-[9px] text-white">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap pr-1 font-semibold flex-1">
                        {item.title || "Media image"}
                      </div>
                      <span className="inline-flex items-center gap-0.5 rounded bg-black/50 px-1 py-0.5 font-medium text-white border border-white/10 shrink-0">
                        {importing ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ImagePlus className="h-2.5 w-2.5" />}
                        {importing ? "..." : "Add"}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        <div ref={sentinelRef} className="h-4" />
        {items.length > 0 && loading ? (
          <div className="mt-2 flex items-center justify-center text-[10px] text-muted-foreground">
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Loading more…
          </div>
        ) : null}
      </div>
    </section>
  );
}
