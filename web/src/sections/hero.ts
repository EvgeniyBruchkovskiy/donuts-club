import { SPK, pick, rnd } from "../lib/random";

/* ---------- falling sprinkles in hero ---------- */
export function initFallingSprinkles(): void {
  const f = document.getElementById("fallField");
  if (!f) return;
  for (let i = 0; i < 26; i++) {
    const s = document.createElement("span");
    s.className = "fall";
    s.style.left = rnd() * 100 + "%";
    s.style.background = pick(SPK);
    s.style.animationDuration = 5 + rnd() * 7 + "s";
    s.style.animationDelay = -rnd() * 12 + "s";
    f.appendChild(s);
  }
}

/* ---------- parallax on hero donuts ---------- */
export function initParallax(): void {
  document.addEventListener("mousemove", (e) => {
    const x = e.clientX / window.innerWidth - 0.5;
    const y = e.clientY / window.innerHeight - 0.5;
    document.querySelectorAll<HTMLElement>("#heroStage .float").forEach((f, i) => {
      const k = (i + 1) * 6;
      f.style.marginLeft = x * k + "px";
      f.style.marginTop = y * k + "px";
    });
  });
}
