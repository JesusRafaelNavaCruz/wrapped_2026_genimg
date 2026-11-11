import http from "node:http";
import { renderKM, renderDefault, KM_PATTERN } from "./generate";

const PORT = Number(process.env.PORT ?? 3000);
const CACHE_MAX = Number(process.env.CACHE_MAX ?? 2000); // ~27 KB c/u ≈ 54 MB máx.

// Caché en memoria (LRU simple usando el orden de inserción del Map).
// Guardamos la Promise para que peticiones simultáneas del mismo km rendericen una sola vez.
const cache = new Map<number, Promise<Buffer>>();

function getImage(km: number): Promise<Buffer> {
  const hit = cache.get(km);
  if (hit) {
    cache.delete(km);
    cache.set(km, hit); // marcar como reciente
    return hit;
  }
  const p = renderKM(km);
  p.catch(() => cache.delete(km)); // no cachear errores
  cache.set(km, p);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return p;
}

let defaultPng: Promise<Buffer> | undefined;
const getDefault = () => (defaultPng ??= renderDefault());

function sendPng(res: http.ServerResponse, png: Buffer, cacheControl: string, head: boolean) {
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": png.length,
    "Cache-Control": cacheControl,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(head ? undefined : png);
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300"; // el default no se cachea para siempre

const server = http.createServer(async (req, res) => {
  const started = performance.now();
  const url = new URL(req.url ?? "/", "http://localhost");
  const head = req.method === "HEAD";

  if (req.method !== "GET" && !head) {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  // Acepta "/?km=20566" (formato del correo) y "/20566.png" (útil para probar en el navegador).
  if (url.pathname !== "/" && !/^\/\d{1,6}\.png$/.test(url.pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }
  const raw = url.searchParams.get("km") ?? url.pathname.match(/^\/(\d{1,6})\.png$/)?.[1] ?? "";

  try {
    if (KM_PATTERN.test(raw)) {
      sendPng(res, await getImage(Number(raw)), IMMUTABLE, head);
    } else {
      // km inválido o ausente: devolvemos la imagen genérica con 200,
      // para que el cliente de correo nunca muestre una imagen rota.
      sendPng(res, await getDefault(), SHORT, head);
    }
  } catch (err) {
    console.error(`[error] km=${raw}`, err);
    try {
      sendPng(res, await getDefault(), "no-store", head);
    } catch {
      res.writeHead(500).end();
    }
  }

  console.log(`${req.method} ${url.pathname}${url.search} -> ${res.statusCode} ${(performance.now() - started).toFixed(0)}ms`);
});

server.listen(PORT, () => {
  console.log(`Servidor de imágenes en http://localhost:${PORT}/?km=20566`);
  void getDefault(); // precalentar
});
