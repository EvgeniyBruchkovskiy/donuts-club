import menu from "../data/menu.json";
import type { MenuItem } from "../data/types";
import { imgAttrs } from "../lib/img";

// Меню пончиків — редагуй src/data/menu.json, сітка оновиться сама.
export function renderMenu(): void {
  const grid = document.getElementById("menuGrid");
  if (!grid) return;
  (menu as MenuItem[]).forEach((m, i) => {
    const c = document.createElement("div");
    c.className = "card reveal";
    c.style.transitionDelay = (i % 4) * 60 + "ms";
    c.innerHTML =
      (m.tag ? '<span class="tag">' + m.tag + "</span>" : "") +
      '<div class="imgwrap"><img class="ph" ' + imgAttrs(m.img || "LOGO") + ' alt="' + m.n + '"></div>' +
      "<h3>" + m.n + "</h3><p>" + m.d + '</p><span class="price">' + m.price + " ₴</span>";
    grid.appendChild(c);
  });
}
