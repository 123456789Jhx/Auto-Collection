import { existsSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type WebRequestHandlerOptions = {
  apiOrigin?: string;
  fetchImpl?: FetchLike;
  publicRoot?: string;
};

const DEFAULT_API_ORIGIN = "http://api:8080";
const DEFAULT_PUBLIC_ROOT = "/app/public";
const DEFAULT_PORT = 80;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
};

function isProxyPath(pathname: string) {
  return pathname.startsWith("/api/") || pathname === "/health" || pathname === "/ready";
}

function looksLikeStaticAsset(pathname: string) {
  return extname(pathname) !== "";
}

function rawPathFromRequestUrl(requestUrl: string) {
  const withoutHash = requestUrl.split("#", 1)[0] ?? requestUrl;
  const withoutQuery = withoutHash.split("?", 1)[0] ?? withoutHash;
  const schemeIndex = withoutQuery.indexOf("://");
  if (schemeIndex === -1) {
    return withoutQuery || "/";
  }

  const pathStart = withoutQuery.indexOf("/", schemeIndex + 3);
  return pathStart === -1 ? "/" : withoutQuery.slice(pathStart);
}

function hasTraversalSegment(requestUrl: string) {
  try {
    const decodedPath = decodeURIComponent(rawPathFromRequestUrl(requestUrl)).replace(/\\/g, "/");
    return decodedPath.split("/").some((segment) => segment === "..");
  } catch {
    return true;
  }
}

function safeFilePath(publicRoot: string, pathname: string) {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath.replace(/^[/\\]+/, "");
  const fullPath = resolve(publicRoot, relativePath);
  const normalizedRoot = resolve(publicRoot);
  const rootWithSeparator = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;

  if (fullPath !== normalizedRoot && !fullPath.startsWith(rootWithSeparator)) {
    return null;
  }

  return fullPath;
}

function headersForFile(filePath: string, pathname: string) {
  const headers = new Headers();
  const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()];
  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (pathname.startsWith("/downloads/")) {
    headers.set("cache-control", "no-store");
  }
  return headers;
}

async function serveFile(filePath: string, pathname: string, method: string) {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  return new Response(method === "HEAD" ? null : file, {
    headers: headersForFile(filePath, pathname),
  });
}

async function proxyRequest(request: Request, url: URL, apiOrigin: string, fetchImpl: FetchLike) {
  const upstreamUrl = new URL(`${url.pathname}${url.search}`, apiOrigin);
  const headers = new Headers(request.headers);
  headers.set("host", upstreamUrl.host);
  headers.set("x-forwarded-host", url.host);
  headers.set("x-forwarded-proto", url.protocol.replace(":", ""));

  const init: RequestInit & { duplex?: "half" } = {
    headers,
    method: request.method,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  return fetchImpl(upstreamUrl.toString(), init);
}

export function createWebRequestHandler(options: WebRequestHandlerOptions = {}) {
  const publicRoot = resolve(options.publicRoot ?? DEFAULT_PUBLIC_ROOT);
  const apiOrigin = options.apiOrigin ?? DEFAULT_API_ORIGIN;
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function handleRequest(request: Request) {
    if (hasTraversalSegment(request.url)) {
      return new Response("Not found", { status: 404 });
    }

    const url = new URL(request.url);
    if (isProxyPath(url.pathname)) {
      return proxyRequest(request, url, apiOrigin, fetchImpl);
    }

    const filePath = safeFilePath(publicRoot, url.pathname);
    if (filePath) {
      const staticResponse = await serveFile(filePath, url.pathname, request.method);
      if (staticResponse) {
        return staticResponse;
      }
    }

    if (url.pathname.startsWith("/downloads/")) {
      return new Response("Not found", { status: 404 });
    }

    if (looksLikeStaticAsset(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    const indexPath = join(publicRoot, "index.html");
    const indexResponse = await serveFile(indexPath, "/index.html", request.method);
    return indexResponse ?? new Response("Not found", { status: 404 });
  };
}

if (import.meta.main) {
  const publicRoot = process.env.PUBLIC_ROOT ?? DEFAULT_PUBLIC_ROOT;
  const apiOrigin = process.env.API_ORIGIN ?? DEFAULT_API_ORIGIN;
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  if (!existsSync(join(publicRoot, "index.html"))) {
    throw new Error(`Web public root is missing index.html: ${publicRoot}`);
  }

  Bun.serve({
    fetch: createWebRequestHandler({ apiOrigin, publicRoot }),
    hostname: "0.0.0.0",
    port,
  });

  console.log(`web server listening on ${port}, proxying API to ${apiOrigin}`);
}
