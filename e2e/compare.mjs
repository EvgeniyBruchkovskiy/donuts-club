// Pixel diff of e2e/shots/before vs e2e/shots/after; writes diff-*.png.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const dir = new URL("./shots/", import.meta.url);
mkdirSync(new URL("diff/", dir), { recursive: true });
let failed = false;
for (const f of readdirSync(new URL("before/", dir))) {
  const a = PNG.sync.read(readFileSync(new URL(`before/${f}`, dir)));
  const b = PNG.sync.read(readFileSync(new URL(`after/${f}`, dir)));
  if (a.width !== b.width || a.height !== b.height) {
    console.log(`${f}: SIZE MISMATCH ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    failed = true;
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  writeFileSync(new URL(`diff/${f}`, dir), PNG.sync.write(diff));
  const pct = ((n / (a.width * a.height)) * 100).toFixed(4);
  console.log(`${f}: ${a.width}x${a.height}, differing px ${n} (${pct}%)`);
  if (n > 0) failed = true;
}
process.exit(failed ? 1 : 0);
