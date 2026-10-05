import "../styles/main.css";
import "../styles/account.css";
import "../styles/feedback.css";
import { httpsCallable } from "firebase/functions";
import { errorMessage } from "../account/errors";
import { prettyPhone, purchaseDate } from "../account/format";
import { functions } from "../lib/firebaseApp";

interface FeedbackView { id: string; createdAt: string; clean: number; staff: number; comment: string; name?: string; phone?: string }
interface FeedbackList { items: FeedbackView[]; stats: { count: number; clean: number | null; staff: number | null } }
type Req = { pin: string; action: "login" | "feedback" };

const call = httpsCallable<Req, { ok: true } | FeedbackList>(functions, "staffAction");
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PIN_KEY = "dc-staff-pin";

function show(state: "loading" | "pin" | "panel") {
  document.querySelectorAll<HTMLElement>("[data-state]").forEach((el) => (el.hidden = el.dataset.state !== state));
  $("logout").hidden = state !== "panel";
  if (state === "pin") requestAnimationFrame(() => $("pinInput").focus());
  if (state === "panel") void loadReviews();
}

/** Our server messages (wrong PIN, lockout) are Ukrainian; pass them through. */
function message(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "functions/resource-exhausted" && e.message) return e.message;
  return errorMessage(err);
}

function setError(id: string, err: unknown) {
  const el = $(id);
  el.textContent = err ? (typeof err === "string" ? err : message(err)) : "";
  el.hidden = !err;
}

function busy(btn: HTMLButtonElement, on: boolean) {
  btn.disabled = on;
  btn.classList.toggle("is-busy", on);
}

const store = {
  get: () => { try { return localStorage.getItem(PIN_KEY) ?? ""; } catch { return ""; } },
  set: (v: string) => { try { if (v) localStorage.setItem(PIN_KEY, v); else localStorage.removeItem(PIN_KEY); } catch { /* private mode */ } },
};
let pin = "";

function isBadPin(err: unknown) {
  return (err as { code?: string })?.code === "functions/failed-precondition";
}

function logout(reason?: unknown) {
  pin = "";
  store.set("");
  $<HTMLInputElement>("pinInput").value = "";
  setError("pinError", reason ?? null);
  show("pin");
}

/* ---------- PIN ---------- */
const pinBtn = $<HTMLButtonElement>("pinSubmit");
$("pinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = $<HTMLInputElement>("pinInput").value.trim();
  if (!value) return setError("pinError", "Введіть PIN.");
  busy(pinBtn, true);
  setError("pinError", null);
  try {
    await call({ pin: value, action: "login" });
    pin = value;
    store.set(value);
    show("panel");
  } catch (err) {
    setError("pinError", err);
  } finally {
    busy(pinBtn, false);
  }
});
$("logout").addEventListener("click", () => logout());

/* ---------- reviews ---------- */
const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

function renderReviews({ items, stats }: FeedbackList) {
  $("statCount").textContent = String(stats.count);
  $("statClean").textContent = stats.clean === null ? "—" : `${stats.clean}★`;
  $("statStaff").textContent = stats.staff === null ? "—" : `${stats.staff}★`;
  const list = $("reviewsList");
  list.innerHTML = "";
  for (const f of items) {
    const li = document.createElement("li");
    li.className = "st-item" + (Math.min(f.clean, f.staff) <= 3 ? " is-low" : "");
    const head = document.createElement("div");
    head.className = "st-item-head";
    const when = document.createElement("span");
    when.textContent = purchaseDate(f.createdAt);
    head.append(when);
    const scores = document.createElement("div");
    scores.className = "st-scores";
    const s1 = document.createElement("span");
    s1.textContent = `Чистота ${stars(f.clean)}`;
    const s2 = document.createElement("span");
    s2.textContent = `Бариста ${stars(f.staff)}`;
    scores.append(s1, s2);
    li.append(head, scores);
    if (f.comment) {
      const c = document.createElement("p");
      c.className = "st-comment";
      c.textContent = f.comment;
      li.append(c);
    }
    if (f.name || f.phone) {
      const c = document.createElement("p");
      c.className = "st-contact";
      c.append(f.name ?? "");
      if (f.phone) {
        const a = document.createElement("a");
        a.href = `tel:+${f.phone}`;
        a.textContent = prettyPhone(`+${f.phone}`);
        c.append(f.name ? " · " : "", a);
      }
      li.append(c);
    }
    list.append(li);
  }
  $("reviewsEmpty").hidden = items.length > 0;
}

const reloadBtn = $<HTMLButtonElement>("reviewsReload");
async function loadReviews() {
  busy(reloadBtn, true);
  setError("reviewsError", null);
  try {
    const { data } = await call({ pin, action: "feedback" });
    if ("items" in data) renderReviews(data);
  } catch (err) {
    if (isBadPin(err)) return logout("PIN змінився. Увійдіть знову.");
    setError("reviewsError", err);
  } finally {
    busy(reloadBtn, false);
  }
}
reloadBtn.addEventListener("click", () => void loadReviews());

/* ---------- start: a saved PIN skips the login screen ---------- */
pin = store.get();
if (pin) {
  call({ pin, action: "login" })
    .then(() => show("panel"))
    .catch((err) => (isBadPin(err) ? logout() : logout(err)));
} else {
  show("pin");
}

// Dev-only hook for visual checks (stripped from production builds).
if (import.meta.env.DEV) {
  Object.assign(window, { __staff: { show, renderReviews, setError } });
}
