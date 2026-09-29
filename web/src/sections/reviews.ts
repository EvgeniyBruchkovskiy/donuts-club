import reviews from "../data/reviews.json";
import type { Review } from "../data/types";

export function renderReviews(): void {
  const g = document.getElementById("revGrid");
  if (!g) return;
  (reviews as Review[]).forEach((v, i) => {
    const el = document.createElement("div");
    el.className = "rev reveal";
    el.style.transitionDelay = i * 90 + "ms";
    el.innerHTML =
      '<div class="stars">★★★★★</div><p>"' + v.t + '"</p>' +
      '<div class="who"><div class="av" style="background:' + v.c + '">' + v.n[0] + "</div><div><b>" + v.n + "</b><span>" + v.r + "</span></div></div>";
    g.appendChild(el);
  });
}
