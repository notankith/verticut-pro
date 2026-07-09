import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center animate-fade-in-up">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-panel px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
          Error 404
        </div>
        <h1 className="text-6xl font-bold tracking-tight text-foreground">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-smooth hover:bg-primary/90 btn-press"
          >
            ← Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Verticut Pro — Vertical Video Editor" },
      { name: "description", content: "Professional vertical video editing with Ken Burns animations, transcript sync, and persistent rendering." },
      { name: "author", content: "Verticut Pro" },
      { property: "og:title", content: "Verticut Pro" },
      { property: "og:description", content: "Professional vertical video editing pipeline" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#0a0a0f" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/svg+xml", href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%230a0a0f'/%3E%3Crect x='28' y='18' width='14' height='64' rx='4' fill='%2300d4cc'/%3E%3Crect x='50' y='18' width='14' height='64' rx='4' fill='%2300d4cc' opacity='0.6'/%3E%3Crect x='72' y='18' width='14' height='64' rx='4' fill='%2300d4cc' opacity='0.3'/%3E%3C/svg%3E" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
            <script
              dangerouslySetInnerHTML={{
                __html: `(() => {
  try {
    const orig = window.fetch.bind(window);
    window.fetch = function(input, init) {
      try {
        const urlStr = typeof input === 'string' ? input : input && input.url;
        if (typeof urlStr === 'string') {
          try {
            const u = new URL(urlStr, window.location.href);
            const isLocalhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
            if (isLocalhost && u.pathname.startsWith('/_serverFn')) {
              const newUrl = window.location.origin + u.pathname + u.search;
              input = newUrl;
            }
          } catch (e) {}
        }
      } catch (e) {}
      return orig(input, init);
    };
  } catch(e) {}
})();`,
              }}
            />
            <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return <Outlet />;
}
