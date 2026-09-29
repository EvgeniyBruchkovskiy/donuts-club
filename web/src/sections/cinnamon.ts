import cinnamon from "../data/cinnamon.json";
import type { Cinnamon, CinnamonItem } from "../data/types";
import { imgAttrs } from "../lib/img";

// Сінамони — редагуй src/data/cinnamon.json.
function render(list: CinnamonItem[], elId: string): void {
  const g = document.getElementById(elId);
  if (!g) return;
  list.forEach((m, i) => {
    const c = document.createElement("div");
    c.className = "ccard reveal";
    c.style.transitionDelay = i * 60 + "ms";
    c.innerHTML =
      (m.tag ? '<span class="tag">' + m.tag + "</span>" : "") +
      '<img class="cimg" ' + imgAttrs(m.img) + ' alt="' + m.n + '"><h3>' + m.n + '</h3><span class="price">' + m.price + " ₴</span>";
    g.appendChild(c);
  });
}

export function renderCinnamon(): void {
  const data = cinnamon as Cinnamon;
  render(data.sweet, "cinSweet");
  render(data.salty, "cinSalty");
}
