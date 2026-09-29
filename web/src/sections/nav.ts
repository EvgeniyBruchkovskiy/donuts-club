/* ---------- mobile nav (behaviour kept exactly as on the legacy page) ---------- */
export function initBurger(): void {
  document.getElementById("burger")?.addEventListener("click", () => {
    const n = document.querySelector<HTMLElement>(".nav-links");
    if (!n) return;
    n.style.display = "flex";
    n.style.position = "absolute";
    n.style.flexDirection = "column";
    n.style.top = "70px";
    n.style.right = "16px";
    n.style.background = "#fff";
    n.style.padding = "18px 22px";
    n.style.borderRadius = "18px";
    n.style.boxShadow = "0 20px 40px rgba(0,0,0,.15)";
  });
}
