// Genera PNG de muestra en ./out para comparar contra el mockup.
// Uso: npm run preview            -> valores por defecto
//      npm run preview -- 20566 7 -> valores específicos
import fs from "node:fs/promises";
import path from "node:path";
import { renderKM, renderDefault } from "../src/generate";

const values = process.argv.slice(2).map(Number);
const kms = values.length ? values : [20566, 0, 7, 845, 1234, 999999];

(async () => {
  const out = path.join(__dirname, "..", "out");
  await fs.mkdir(out, { recursive: true });

  for (const km of kms) {
    const t = performance.now();
    const png = await renderKM(km);
    await fs.writeFile(path.join(out, `${km}.png`), png);
    console.log(`${km}.png  ${(png.length / 1024).toFixed(1)} KB  ${(performance.now() - t).toFixed(0)} ms`);
  }
  const def = await renderDefault();
  await fs.writeFile(path.join(out, "default.png"), def);
  console.log(`default.png  ${(def.length / 1024).toFixed(1)} KB`);
})();
