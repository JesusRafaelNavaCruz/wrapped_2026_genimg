// Genera imágenes de muestra en ./out para comparar contra los mockups.
// Uso: npm run preview                -> casos por defecto
//      npm run preview -- 20566 7     -> solo tarjetas de km con esos valores
import fs from "node:fs/promises";
import path from "node:path";
import { renderKM, renderRadar, renderDefault, normalizeName, type Rendered } from "../src/generate";

const ext = (r: Rendered) => (r.type === "image/jpeg" ? "jpg" : "png");

(async () => {
  const out = path.join(__dirname, "..", "out");
  await fs.mkdir(out, { recursive: true });

  const save = async (name: string, job: Promise<Rendered>) => {
    const t = performance.now();
    const r = await job;
    const file = `${name}.${ext(r)}`;
    await fs.writeFile(path.join(out, file), r.body);
    console.log(`${file.padEnd(34)} ${(r.body.length / 1024).toFixed(1).padStart(6)} KB  ${(performance.now() - t).toFixed(0)} ms`);
  };

  const args = process.argv.slice(2).map(Number);
  const kms = args.length ? args : [20566, 0, 7, 999999];
  for (const km of kms) await save(`km-${km}`, renderKM(km));
  if (args.length) return;

  // Radar: nombres de prueba (acentos, mayúsculas, largos, vacíos, basura)
  for (const raw of ["Rafael", "FER", "maría fernanda", "Maximiliano", "Anaximandro-Sebastián", "", "🎉<script>"]) {
    const name = normalizeName(raw);
    await save(`radar-${name || "vacio"}`, renderRadar(name, null));
  }
  await save("radar-Rafael-km-20566", renderRadar("Rafael", 20566));
  await save("default", renderDefault());
})();
