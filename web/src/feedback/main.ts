import "../styles/main.css";
import "../styles/account.css";
import "../styles/feedback.css";
import { httpsCallable } from "firebase/functions";
import { errorMessage } from "../account/errors";
import { formatNational, isComplete, isMobile, nationalDigits, toE164 } from "../account/phoneMask";
import { functions } from "../lib/firebaseApp";
import { initStars } from "./stars";
import { thanksCopy } from "./copy";

type State = "survey" | "contacts" | "thanks";
type Payload = { clean: number; staff: number; comment: string; name?: string; phone?: string };

const submit = httpsCallable<Payload, { ok: true }>(functions, "submitFeedback");
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function show(state: State) {
  document.querySelectorAll<HTMLElement>("[data-state]").forEach((el) => (el.hidden = el.dataset.state !== state));
  window.scrollTo({ top: 0 });
  if (state === "contacts") requestAnimationFrame(() => $("fbName").focus());
}

function setError(id: string, err: unknown) {
  const el = $(id);
  el.textContent = err ? (typeof err === "string" ? err : errorMessage(err)) : "";
  el.hidden = !err;
}

/* ---------- step 1: ratings + comment ---------- */
const ratings: { clean: number; staff: number } = { clean: 0, staff: 0 };
const nextBtn = $<HTMLButtonElement>("surveyNext");
for (const key of ["clean", "staff"] as const) {
  initStars(document.querySelector<HTMLElement>(`[data-rating="${key}"]`)!, document.querySelector<HTMLElement>(`[data-word="${key}"]`)!, key, (v) => {
    ratings[key] = v;
    nextBtn.disabled = !(ratings.clean && ratings.staff);
    setError("surveyError", null);
  });
}

$("surveyForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!ratings.clean || !ratings.staff) return setError("surveyError", "Оцініть, будь ласка, обидва пункти.");
  show("contacts");
});

/* ---------- step 2: optional name + phone ---------- */
const phoneInput = $<HTMLInputElement>("fbPhone");
let national = "";
phoneInput.addEventListener("input", () => {
  national = nationalDigits(phoneInput.value);
  phoneInput.value = formatNational(national);
  setError("contactsError", null);
});
phoneInput.addEventListener("keydown", (e) => {
  if (e.key === "Backspace" && phoneInput.selectionStart === phoneInput.value.length && national) {
    e.preventDefault();
    national = national.slice(0, -1);
    phoneInput.value = formatNational(national);
  }
});
$("fbName").addEventListener("input", () => setError("contactsError", null));
$("backToSurvey").addEventListener("click", () => show("survey"));

const sendBtn = $<HTMLButtonElement>("sendFeedback");

async function send() {
  const payload: Payload = { ...ratings, comment: $<HTMLTextAreaElement>("fbComment").value.trim() };
  const name = $<HTMLInputElement>("fbName").value.trim();
  if (name) {
    if (name.length < 2) return setError("contactsError", "Ім'я — щонайменше 2 літери.");
    payload.name = name;
  }
  if (national) {
    if (!isComplete(national) || !isMobile(national)) return setError("contactsError", "Перевірте номер телефону — потрібен український мобільний.");
    payload.phone = toE164(national);
  }
  sendBtn.disabled = true;
  sendBtn.classList.add("is-busy");
  setError("contactsError", null);
  try {
    await submit(payload);
    renderThanks(!!payload.phone);
  } catch (err) {
    setError("contactsError", err);
  } finally {
    sendBtn.disabled = false;
    sendBtn.classList.remove("is-busy");
  }
}

$("contactsForm").addEventListener("submit", (e) => {
  e.preventDefault();
  void send();
});

/* ---------- result ---------- */
function renderThanks(withContacts: boolean) {
  const copy = thanksCopy(Math.min(ratings.clean, ratings.staff) <= 3, withContacts);
  $("thanksIcon").textContent = copy.icon;
  $("thanksTitle").textContent = copy.title;
  $("thanksText").textContent = copy.text;
  show("thanks");
}

// Dev-only hook for visual checks of every screen (stripped from production builds).
if (import.meta.env.DEV) {
  Object.assign(window, { __feedback: { show, renderThanks, setError, ratings } });
}
