/* ---------- scroll reveal ---------- */
let io: IntersectionObserver | null = null;

export function initReveal(): void {
  io = new IntersectionObserver(
    (es) => {
      es.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io?.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12 },
  );
  document.querySelectorAll(".reveal").forEach((el) => io!.observe(el));
}

/** For elements added after initReveal() (content fetched later). */
export function reveal(el: Element): void {
  el.classList.add("reveal");
  if (io) io.observe(el);
  else el.classList.add("in");
}
