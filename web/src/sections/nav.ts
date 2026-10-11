/* ---------- mobile nav: ☰ toggles the menu; a link, a tap outside or Esc closes it ---------- */
export function initBurger(): void {
  const burger = document.getElementById("burger");
  const links = document.querySelector<HTMLElement>(".nav-links");
  if (!burger || !links) return;

  const setOpen = (open: boolean): void => {
    links.classList.toggle("open", open);
    burger.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", String(open));
  };

  burger.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(!links.classList.contains("open"));
  });
  links.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) setOpen(false);
  });
  document.addEventListener("click", (e) => {
    if (links.classList.contains("open") && !links.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
}
