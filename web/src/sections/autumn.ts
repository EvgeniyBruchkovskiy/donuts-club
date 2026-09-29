import autumn from "../data/autumn.json";
import type { AutumnItem, AutumnTab } from "../data/types";
import { imgAttrs } from "../lib/img";

// Осіннє меню — редагуй src/data/autumn.json (вкладки й позиції).
const AUTUMN = autumn as AutumnTab[];

function card(m: AutumnItem, i: number): string {
  return (
    '<div class="dcard aut-card" style="animation-delay:' + i * 45 + 'ms">' +
    (m.img ? '<img class="dimg" ' + imgAttrs(m.img) + ' alt="' + m.n + '">' : "") +
    '<div class="dhead"><h3>' + m.n + (m.tag ? ' <span class="tag">' + m.tag + "</span>" : "") + "</h3>" +
    '<span class="price">' + m.price + " ₴</span></div><p>" + m.d + "</p></div>"
  );
}

export function renderAutumn(): void {
  const tabs = document.getElementById("autTabs");
  const grid = document.getElementById("autGrid");
  if (!tabs || !grid) return;
  const show = (k: number) => {
    [...tabs.children].forEach((b, j) => b.classList.toggle("on", j === k));
    grid.innerHTML = AUTUMN[k].items.map(card).join("");
  };
  AUTUMN.forEach((g, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = g.tab;
    b.addEventListener("click", () => show(i));
    tabs.appendChild(b);
  });
  show(0);
}
