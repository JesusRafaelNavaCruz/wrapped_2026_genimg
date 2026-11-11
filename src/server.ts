import http from "node:http";
import { renderKM, renderRadar, renderDefault, normalizeName, KM_PATTERN, type Rendered } from "./generate";

const PORT = Number(process.env.PORT ?? 3000);
// Límite de la caché en memoria, en MB (el radar pesa ~150-220 KB por imagen).
const CACHE_MAX_BYTES = Number(process.env.CACHE_MAX_MB ?? 150) * 1024 * 1024;

// ---------------------------------------------------------------------------
// Caché LRU por bytes. Guardamos la Promise para que peticiones simultáneas
// de la misma imagen la rendericen una sola vez.
// ---------------------------------------------------------------------------
const cache = new Map<string, Promise<Rendered>>();
const sizes = new Map<string, number>();
let cachedBytes = 0;

function evict() {
  while (cachedBytes > CACHE_MAX_BYTES && cache.size > 0) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest);
    cachedBytes -= sizes.get(oldest) ?? 0;
    sizes.delete(oldest);
  }
}

function cached(key: string, render: () => Promise<Rendered>): Promise<Rendered> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // marcar como reciente
    return hit;
  }
  const p = render();
  cache.set(key, p);
  p.then(
    (r) => {
      if (cache.get(key) !== p) return; // ya fue desalojada
      sizes.set(key, r.body.length);
      cachedBytes += r.body.length;
      evict();
    },
    () => cache.delete(key), // no cachear errores
  );
  return p;
}

let defaultImg: Promise<Rendered> | undefined;
const getDefault = () => (defaultImg ??= renderDefault());

// ---------------------------------------------------------------------------
// Resolución de parámetros
//   ?km=20566               -> tarjeta de km
//   ?radar=Rafael           -> radar con saludo
//   ?radar=Rafael&km=20566  -> radar + km en una sola imagen
//   ?radar= (vacío/inválido)-> radar con "¡Hola!" (y km si es válido)
//   nada válido             -> imagen genérica
// ---------------------------------------------------------------------------
type Job = { key: string; render: () => Promise<Rendered> } | null;

function resolveJob(url: URL): Job {
  const rawKm = url.searchParams.get("km") ?? url.pathname.match(/^\/(\d{1,6})\.png$/)?.[1] ?? "";
  const km = KM_PATTERN.test(rawKm) ? Number(rawKm) : null;

  if (url.searchParams.has("radar")) {
    const name = normalizeName(url.searchParams.get("radar") ?? "");
    return { key: `radar|${name}|${km ?? ""}`, render: () => renderRadar(name, km) };
  }
  if (km !== null) {
    return { key: `km|${km}`, render: () => renderKM(km) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=300"; // el default no se cachea para siempre

function send(res: http.ServerResponse, img: Rendered, cacheControl: string, head: boolean) {
  res.writeHead(200, {
    "Content-Type": img.type,
    "Content-Length": img.body.length,
    "Cache-Control": cacheControl,
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(head ? undefined : img.body);
}

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

  // Acepta "/?..." (formato del correo) y "/20566.png" (útil para probar en el navegador).
  if (url.pathname !== "/" && !/^\/\d{1,6}\.png$/.test(url.pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }

  const job = resolveJob(url);
  // En logs no escribimos el nombre (dato personal); solo el tipo de imagen.
  const label = job ? job.key.split("|")[0] : "default";

  try {
    if (job) {
      send(res, await cached(job.key, job.render), IMMUTABLE, head);
    } else {
      // Parámetros inválidos o ausentes: imagen genérica con 200,
      // para que el cliente de correo nunca muestre una imagen rota.
      send(res, await getDefault(), SHORT, head);
    }
  } catch (err) {
    console.error(`[error] ${label}`, err);
    try {
      send(res, await getDefault(), "no-store", head);
    } catch {
      res.writeHead(500).end();
    }
  }

  console.log(`${req.method} ${label} -> ${res.statusCode} ${(performance.now() - started).toFixed(0)}ms`);
});

server.listen(PORT, () => {
  console.log(`Servidor de imágenes en http://localhost:${PORT}/?km=20566&radar=Rafael`);
  void getDefault(); // precalentar
});
