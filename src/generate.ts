import path from "node:path";
import { createCanvas, loadImage, GlobalFonts, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// Assets (cargados una sola vez al importar el módulo)
// ---------------------------------------------------------------------------
const ASSETS = path.join(__dirname, "..", "assets");

GlobalFonts.registerFromPath(path.join(ASSETS, "Din-Condensed-Font.ttf"), "Digits");
GlobalFonts.registerFromPath(path.join(ASSETS, "Poppins-Regular.ttf"), "PoppinsRegular");
GlobalFonts.registerFromPath(path.join(ASSETS, "Poppins-Bold.ttf"), "PoppinsBold");

let bgPromise: Promise<Image> | undefined;
const background = () => (bgPromise ??= loadImage(path.join(ASSETS, "background_card_clouds.png")));

let radarPromise: Promise<Image> | undefined;
const radarBackground = () => (radarPromise ??= loadImage(path.join(ASSETS, "background_radar_w_button.png")));

export type Rendered = { body: Buffer; type: "image/png" | "image/jpeg" };

// ---------------------------------------------------------------------------
// Layout (todo en px @2x; se muestra a 668×332 en el correo)
// ---------------------------------------------------------------------------
export const W = 1336;
export const H = 700;

const SKY_TOP = "#14A3F2";
const SKY_BOTTOM = "#00C6FF";
const TEXT = "#0E4B2A";
const DIGIT = "#1B5232";
const TILE_TOP = "#E6E6E6";
const TILE_BOTTOM = "#FFFFFF";

// El PNG de fondo mide 1920×1028; la tarjeta ocupa x 86..1834, y 0..762.
// Lo escalamos al ancho completo para que las nubes salgan por los bordes.
const BG_SCALE = W / 1920;
const BG_X = 0;
const BG_Y = 14;

const TITLE_Y = 124; // línea base visual "Este año recorriste"
const SUBTITLE_Y = 440; // "Kilómetros con Viva"
const TEXT_SIZE = 50;

const TILE_W = 120;
const TILE_H = 188;
const TILE_GAP = 12;
const GROUP_GAP = 12; // separación extra entre miles (20 566)
const TILE_Y = 190;
const TILE_R = 16; // radio de las esquinas de cada mitad (en el correo se ve a la mitad)
const SPLIT = 6; // hueco entre la mitad superior e inferior (el "flip")
const DIGIT_SIZE = 160;

export const KM_PATTERN = /^\d{1,6}$/;

// ---------------------------------------------------------------------------
// Layout del Radar (asset 1920×1872 con fondo transparente, botón incluido)
// ---------------------------------------------------------------------------
const RADAR_SCALE = W / 1920;
const RADAR_TOP_PAD = 100; // cielo extra arriba de la tarjeta (como en el mockup)
export const RADAR_H = Math.ceil(1872 * RADAR_SCALE) + RADAR_TOP_PAD; // 1403

// Degradado del cielo muestreado del mockup: blanco arriba -> azul a media altura.
const RADAR_SKY: Array<[number, string]> = [
  [0, "#FFFFFF"],
  [0.05, "#EBFBFF"],
  [0.23, "#86E9FF"],
  [0.46, "#09D1FE"],
  [0.69, "#00CCFF"],
  [1, "#00C9FF"],
];
const RADAR_SKY_END = "#00C9FF";

const GREETING_COLOR = "#00472F";
const GREETING_SIZE = 60; // reproduce "¡Hola Fer!" del mockup
const GREETING_MIN_SIZE = 36; // nombres largos se reducen hasta este tamaño
const GREETING_CENTER_Y = 376; // centro vertical del saludo
// Ancho máximo: entre el emoji ✈️ de la izquierda (termina en x≈252) y su simétrico.
const GREETING_MAX_W = 780;

const NAME_MAX = 16;
const NAME_PATTERN = /^\p{L}+(?:['’-]\p{L}+)*$/u;

/**
 * Limpia el nombre que llega en la URL. Si no es válido devuelve "" (-> "¡Hola!").
 * - solo la primera palabra ("María Fernanda" -> "María")
 * - solo letras (con acentos/ñ), apóstrofo o guion internos; si trae emojis,
 *   números o símbolos se descarta completo (no se "rescatan" letras sueltas)
 * - si es muy largo y compuesto, usa la primera parte ("Ana-Sofía…" -> "Ana");
 *   nunca se corta a media palabra
 * - "RAFAEL" / "rafael" -> "Rafael" (respeta mayúsculas mixtas como "McKenzie")
 */
export function normalizeName(raw: string): string {
  let clean = raw.normalize("NFC").trim().split(/\s+/)[0] ?? "";
  if (!NAME_PATTERN.test(clean)) return "";
  if (clean.length > NAME_MAX) clean = clean.split(/['’-]/)[0]!;
  if (clean.length > NAME_MAX) return "";
  const mixed = clean !== clean.toLocaleLowerCase("es") && clean !== clean.toLocaleUpperCase("es");
  if (mixed) return clean;
  return clean
    .toLocaleLowerCase("es")
    .replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase("es"));
}

// ---------------------------------------------------------------------------
// Helpers de dibujo
// ---------------------------------------------------------------------------
type Run = { text: string; bold: boolean };

/** Dibuja una línea con partes regular/negrita, centrada en X. */
function drawRichLine(ctx: SKRSContext2D, runs: Run[], cy: number) {
  const fontFor = (bold: boolean) => `${TEXT_SIZE}px ${bold ? "PoppinsBold" : "PoppinsRegular"}`;
  const widths = runs.map((r) => {
    ctx.font = fontFor(r.bold);
    return ctx.measureText(r.text).width;
  });
  let x = (W - widths.reduce((a, b) => a + b, 0)) / 2;

  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  runs.forEach((r, i) => {
    ctx.font = fontFor(r.bold);
    ctx.fillText(r.text, x, cy);
    x += widths[i]!;
  });
}

function drawTile(ctx: SKRSContext2D, x: number, digit: string) {
  // Dos mitades independientes, cada una con sus 4 esquinas redondeadas,
  // separadas por un hueco de SPLIT px por el que se ve la tarjeta.
  const halfH = (TILE_H - SPLIT) / 2;
  const topY = TILE_Y;
  const bottomY = TILE_Y + halfH + SPLIT;

  const halfPath = (y: number) => {
    ctx.beginPath();
    ctx.roundRect(x, y, TILE_W, halfH, TILE_R);
  };

  // mitades con sombra suave
  ctx.save();
  ctx.shadowColor = "rgba(0, 60, 20, 0.25)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = TILE_TOP;
  halfPath(topY);
  ctx.fill();
  ctx.fillStyle = TILE_BOTTOM;
  halfPath(bottomY);
  ctx.fill();
  ctx.restore();

  // dígito: se dibuja una vez por mitad, recortado a esa mitad,
  // para que no se pinte en el hueco entre ambas.
  ctx.font = `${DIGIT_SIZE}px Digits`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(digit);
  const glyphH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const baseline = TILE_Y + TILE_H / 2 + glyphH / 2 - m.actualBoundingBoxDescent;

  for (const y of [topY, bottomY]) {
    ctx.save();
    halfPath(y);
    ctx.clip();
    ctx.fillStyle = DIGIT;
    ctx.fillText(digit, x + TILE_W / 2, baseline);
    ctx.restore();
  }
}

/** Posiciones X de cada ficha, con espacio extra entre grupos de miles. */
function tilePositions(count: number): number[] {
  const xs: number[] = [];
  let x = 0;
  for (let i = 0; i < count; i++) {
    xs.push(x);
    const remaining = count - i - 1;
    x += TILE_W + TILE_GAP + (remaining > 0 && remaining % 3 === 0 ? GROUP_GAP : 0);
  }
  const total = x - TILE_GAP;
  const offset = (W - total) / 2;
  return xs.map((v) => v + offset);
}

function fillGradient(ctx: SKRSContext2D, y: number, h: number, stops: Array<[number, string]>) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, y, W, h);
}

/** Tarjeta verde de km (sin cielo). Se dibuja en el origen actual del contexto. */
async function drawKmCard(ctx: SKRSContext2D, km: number) {
  const bg = await background();
  ctx.drawImage(bg, BG_X, BG_Y, bg.width * BG_SCALE, bg.height * BG_SCALE);

  drawRichLine(ctx, [{ text: "Este año ", bold: false }, { text: "recorriste", bold: true }], TITLE_Y);

  const digits = String(km).split("");
  tilePositions(digits.length).forEach((x, i) => drawTile(ctx, x, digits[i]!));

  drawRichLine(ctx, [{ text: "Kilómetros con ", bold: false }, { text: "Viva", bold: true }], SUBTITLE_Y);
}

/** "¡Hola Rafael!" centrado; reduce la fuente si el nombre es muy largo. */
function drawGreeting(ctx: SKRSContext2D, name: string) {
  const text = name ? `¡Hola ${name}!` : "¡Hola!";
  let size = GREETING_SIZE;
  ctx.font = `${size}px PoppinsRegular`;
  while (ctx.measureText(text).width > GREETING_MAX_W && size > GREETING_MIN_SIZE) {
    size -= 2;
    ctx.font = `${size}px PoppinsRegular`;
  }
  // Centro vertical fijo usando un texto de referencia, para que nombres con
  // acentos (Á) o descendentes (g, j) no muevan la línea.
  const ref = ctx.measureText("¡Hola");
  const baseline = GREETING_CENTER_Y + (ref.actualBoundingBoxAscent - ref.actualBoundingBoxDescent) / 2;

  ctx.fillStyle = GREETING_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, W / 2, baseline);
}

function assertKm(km: number) {
  if (!Number.isInteger(km) || km < 0 || km > 999_999) {
    throw new RangeError(`km fuera de rango: ${km}`);
  }
}

/** PNG con paleta: mantiene los textos nítidos y pesa poco (tarjeta de km). */
async function encodePng(raw: Buffer): Promise<Rendered> {
  const body = await sharp(raw).png({ palette: true, quality: 90, effort: 8, compressionLevel: 9, dither: 0.6 }).toBuffer();
  return { body, type: "image/png" };
}

/** JPEG para el radar: tiene foto (avión) y degradados, donde PNG pesa demasiado. */
async function encodeJpeg(raw: Buffer): Promise<Rendered> {
  const body = await sharp(raw).jpeg({ quality: 84, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  return { body, type: "image/jpeg" };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** ?km=20566 -> tarjeta de km (1336×H). */
export async function renderKM(km: number): Promise<Rendered> {
  assertKm(km);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  fillGradient(ctx, 0, H, [[0, SKY_TOP], [1, SKY_BOTTOM]]);
  await drawKmCard(ctx, km);
  return encodePng(canvas.toBuffer("image/png"));
}

/**
 * ?radar=Rafael          -> tarjeta del radar con saludo (1336×RADAR_H)
 * ?radar=Rafael&km=20566 -> radar + tarjeta de km debajo, en una sola imagen (1336×(RADAR_H+H))
 * `name` ya debe venir normalizado (normalizeName); vacío -> "¡Hola!".
 */
export async function renderRadar(name: string, km: number | null): Promise<Rendered> {
  if (km !== null) assertKm(km);
  const totalH = RADAR_H + (km !== null ? H : 0);
  const canvas = createCanvas(W, totalH);
  const ctx = canvas.getContext("2d");

  // Cielo: el del radar, y si hay km, continúa sin corte hacia el azul de la tarjeta de km.
  fillGradient(ctx, 0, RADAR_H, RADAR_SKY);
  if (km !== null) fillGradient(ctx, RADAR_H, H, [[0, RADAR_SKY_END], [1, SKY_BOTTOM]]);

  const radar = await radarBackground();
  ctx.drawImage(radar, 0, RADAR_TOP_PAD, radar.width * RADAR_SCALE, radar.height * RADAR_SCALE);
  drawGreeting(ctx, name);

  if (km !== null) {
    ctx.save();
    ctx.translate(0, RADAR_H);
    await drawKmCard(ctx, km);
    ctx.restore();
  }

  return encodeJpeg(canvas.toBuffer("image/png"));
}

/** Imagen de respaldo cuando los parámetros no son válidos o falla el render. */
export async function renderDefault(): Promise<Rendered> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  fillGradient(ctx, 0, H, [[0, SKY_TOP], [1, SKY_BOTTOM]]);
  const bg = await background();
  ctx.drawImage(bg, BG_X, BG_Y, bg.width * BG_SCALE, bg.height * BG_SCALE);
  drawRichLine(ctx, [{ text: "Este año ", bold: false }, { text: "viajaste", bold: true }], 240);
  drawRichLine(ctx, [{ text: "con ", bold: false }, { text: "Viva", bold: true }], 320);
  return encodePng(canvas.toBuffer("image/png"));
}
