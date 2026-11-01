import { reveal } from "../lib/reveal";

/** What /api/reviews returns (functions/src/feedback.ts publicReviews): no phone, ever. */
export interface PublicReview {
  id: string;
  createdAt: string;
  clean: number;
  staff: number;
  comment: string;
  name?: string;
}

const COLORS = ["#FF6FA6", "#7CC5FF", "#8BE0C6", "#FFB457", "#B49CFF", "#FF8A80"];
const FIRST_BATCH = 6;
const GUEST = "Гість";

const dateFmt = new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Kyiv" });

/** "12 жовтня 2026 р." → "12 жовтня 2026". */
export function reviewDate(iso: string): string {
  return dateFmt.format(new Date(iso)).replace(/\s*р\.$/, "");
}

/** One star row for the card: the two ratings averaged, half-stars rounded up. */
export function overallStars(r: Pick<PublicReview, "clean" | "staff">): number {
  return Math.round((r.clean + r.staff) / 2);
}

function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return COLORS[h % COLORS.length];
}

export function reviewCard(v: PublicReview): HTMLElement {
  const name = v.name || GUEST;
  const n = overallStars(v);
  const el = document.createElement("article");
  el.className = "rev";

  const stars = document.createElement("div");
  stars.className = "stars";
  stars.setAttribute("aria-label", `${n} з 5`);
  stars.textContent = "★".repeat(n) + "☆".repeat(5 - n);

  const text = document.createElement("p");
  text.textContent = `«${v.comment}»`;

  const who = document.createElement("div");
  who.className = "who";
  const av = document.createElement("div");
  av.className = "av";
  av.style.background = avatarColor(name);
  av.textContent = [...name][0]!.toUpperCase();
  const meta = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = name;
  const when = document.createElement("span");
  when.textContent = reviewDate(v.createdAt);
  meta.append(b, when);
  who.append(av, meta);

  el.append(stars, text, who);
  return el;
}

async function load(): Promise<PublicReview[]> {
  try {
    const res = await fetch("/api/reviews", { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: PublicReview[] };
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return []; // offline or the API is down — the section keeps its title and the «Залишити відгук» button
  }
}

export function renderReviewList(items: PublicReview[]): void {
  const grid = document.getElementById("revGrid");
  const empty = document.getElementById("revEmpty");
  const more = document.getElementById("revMore") as HTMLButtonElement | null;
  if (!grid) return;
  grid.innerHTML = "";
  grid.hidden = items.length === 0;
  if (empty) empty.hidden = items.length > 0;

  items.forEach((v, i) => {
    const el = reviewCard(v);
    if (i >= FIRST_BATCH) el.hidden = true;
    else {
      el.style.transitionDelay = `${(i % 3) * 90}ms`;
      reveal(el);
    }
    grid.append(el);
  });

  if (more) {
    more.hidden = items.length <= FIRST_BATCH;
    more.onclick = () => {
      grid.querySelectorAll<HTMLElement>(".rev[hidden]").forEach((el) => {
        el.hidden = false;
        el.classList.add("in");
      });
      more.hidden = true;
    };
  }
}

/** Real reviews from /feedback, newest first; shows the name the guest typed and never the phone. */
export function renderReviews(): void {
  if (!document.getElementById("revGrid")) return;
  void load().then(renderReviewList);
}
