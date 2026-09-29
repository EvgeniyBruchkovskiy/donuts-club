// One-off: evaluate the legacy data arrays and write them as JSON.
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");

function grab(name, endMarker) {
  const start = html.indexOf(`var ${name}=`);
  const end = html.indexOf(endMarker, start) + endMarker.length;
  const ctx = {};
  vm.runInNewContext(html.slice(start, end) + `;this.out=${name};`, ctx);
  return ctx.out;
}

const out = {
  menu: grab("MENU", "\n];"),
  cinnamon: grab("SINAMONI", "\n};"),
  autumn: grab("AUTUMN", "\n];"),
  reviews: grab("REV", "\n];"),
};
for (const [file, data] of Object.entries(out)) {
  writeFileSync(new URL(`web/src/data/${file}.json`, root), JSON.stringify(data, null, 2) + "\n");
}
console.error(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v)])));
