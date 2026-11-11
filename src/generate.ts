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

async function baseCanvas() {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Agrega el gradient bg
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_BOTTOM);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const bg = await background();
  ctx.drawImage(bg, BG_X, BG_Y, bg.width * BG_SCALE, bg.height * BG_SCALE);
  return { canvas, ctx };
}

/** PNG con paleta: mantiene los textos nítidos y pesa < 100 KB. */
async function encode(raw: Buffer): Promise<Buffer> {
  return sharp(raw).png({ palette: true, quality: 90, effort: 8, compressionLevel: 9, dither: 0.6 }).toBuffer();
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------
export async function renderKM(km: number): Promise<Buffer> {
  if (!Number.isInteger(km) || km < 0 || km > 999_999) {
    throw new RangeError(`km fuera de rango: ${km}`);
  }
  const { canvas, ctx } = await baseCanvas();

  drawRichLine(ctx, [{ text: "Este año ", bold: false }, { text: "recorriste", bold: true }], TITLE_Y);

  const digits = String(km).split("");
  tilePositions(digits.length).forEach((x, i) => drawTile(ctx, x, digits[i]!));

  drawRichLine(ctx, [{ text: "Kilómetros con ", bold: false }, { text: "Viva", bold: true }], SUBTITLE_Y);

  return encode(canvas.toBuffer("image/png"));
}

/** Imagen de respaldo cuando el km no es válido o falla el render. */
export async function renderDefault(): Promise<Buffer> {
  const { canvas, ctx } = await baseCanvas();
  drawRichLine(ctx, [{ text: "Este año ", bold: false }, { text: "viajaste", bold: true }], 240);
  drawRichLine(ctx, [{ text: "con ", bold: false }, { text: "Viva", bold: true }], 320);
  return encode(canvas.toBuffer("image/png"));
}
