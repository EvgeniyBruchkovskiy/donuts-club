import { imgAttrs } from "../lib/img";

const BG = ["#FFE0EF", "#FFF0D6", "#E4F6FF", "#E8FBF3", "#F0E7FF", "#FFE7E9"];
const KEYS = ["PINEAPPLE", "RAINBOW", "BLUEBERRY", "STRAWBERRY", "CAPPUCINO", "NUT"];

export function renderInsta(): void {
  const g = document.getElementById("igGrid");
  if (!g) return;
  for (let i = 0; i < 6; i++) {
    const el = document.createElement("div");
    el.className = "ig reveal";
    el.style.background = BG[i];
    el.style.transitionDelay = i * 60 + "ms";
    el.innerHTML = '<img class="ph" ' + imgAttrs(KEYS[i]) + ' alt="">';
    g.appendChild(el);
  }
}
