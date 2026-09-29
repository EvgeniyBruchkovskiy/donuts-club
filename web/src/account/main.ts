import "../styles/main.css";
import "../styles/account.css";
import { onAuthStateChanged, RecaptchaVerifier, signInWithPhoneNumber, signOut, type ConfirmationResult } from "firebase/auth";
import QRCode from "qrcode";
import { errorMessage } from "./errors";
import { api, auth } from "./firebase";
import { firstName, prettyPhone, purchaseDate, uah } from "./format";
import { formatMasked, formatNational, isComplete, nationalDigits, toE164 } from "./phoneMask";
import type { Loyalty } from "./types";

const RESEND_SECONDS = 60;
type State = "loading" | "phone" | "code" | "join" | "cabinet" | "failed";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function show(state: State) {
  document.querySelectorAll<HTMLElement>("[data-state]").forEach((el) => (el.hidden = el.dataset.state !== state));
  const focus = { phone: "phoneInput", code: "codeInput", join: "joinName" }[state as string];
  if (focus) requestAnimationFrame(() => $(focus).focus());
}

function setError(id: string, err: unknown) {
  const el = $(id);
  el.textContent = err ? (typeof err === "string" ? err : errorMessage(err)) : "";
  el.hidden = !err;
}

function busy(btn: HTMLButtonElement, on: boolean) {
  btn.disabled = on;
  btn.classList.toggle("is-busy", on);
}

/* ---------- phone step ---------- */
const phoneInput = $<HTMLInputElement>("phoneInput");
const sendBtn = $<HTMLButtonElement>("sendCode");
let national = "";

function renderPhone() {
  phoneInput.value = formatNational(national);
  sendBtn.disabled = !isComplete(national);
}

phoneInput.addEventListener("input", () => {
  national = nationalDigits(phoneInput.value);
  renderPhone();
  setError("phoneError", null);
});
phoneInput.addEventListener("keydown", (e) => {
  // Backspace over a mask character should still delete a digit.
  if (e.key === "Backspace" && phoneInput.selectionStart === phoneInput.value.length && national) {
    e.preventDefault();
    national = national.slice(0, -1);
    renderPhone();
  }
});

let verifier: RecaptchaVerifier | null = null;
let confirmation: ConfirmationResult | null = null;

function freshVerifier(): RecaptchaVerifier {
  verifier?.clear();
  const host = $("recaptcha");
  host.innerHTML = "";
  const slot = document.createElement("div");
  host.appendChild(slot);
  verifier = new RecaptchaVerifier(auth, slot, { size: "invisible" });
  return verifier;
}

async function sendCode(btn: HTMLButtonElement, errorId: string) {
  busy(btn, true);
  setError(errorId, null);
  try {
    confirmation = await signInWithPhoneNumber(auth, toE164(national), freshVerifier());
    $("codePhone").textContent = formatMasked(national);
    $<HTMLInputElement>("codeInput").value = "";
    show("code");
    startResendTimer();
  } catch (err) {
    setError(errorId, err);
  } finally {
    busy(btn, false);
    if (btn === sendBtn) sendBtn.disabled = !isComplete(national);
  }
}

$("phoneForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (isComplete(national)) void sendCode(sendBtn, "phoneError");
});

/* ---------- code step ---------- */
const codeInput = $<HTMLInputElement>("codeInput");
const verifyBtn = $<HTMLButtonElement>("verifyCode");
const resendBtn = $<HTMLButtonElement>("resendCode");
let timer = 0;

function startResendTimer() {
  let left = RESEND_SECONDS;
  window.clearInterval(timer);
  const tick = () => {
    resendBtn.disabled = left > 0;
    resendBtn.textContent = left > 0 ? `Надіслати ще раз через 0:${String(left).padStart(2, "0")}` : "Надіслати код ще раз";
    left--;
    if (left < -1) window.clearInterval(timer);
  };
  tick();
  timer = window.setInterval(tick, 1000);
}

async function verify() {
  const code = codeInput.value.replace(/\D/g, "");
  if (code.length !== 6 || !confirmation) return setError("codeError", "Введіть 6 цифр з SMS.");
  busy(verifyBtn, true);
  setError("codeError", null);
  try {
    await confirmation.confirm(code); // onAuthStateChanged takes it from here
  } catch (err) {
    setError("codeError", err);
    busy(verifyBtn, false);
  }
}

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 6);
  setError("codeError", null);
  if (codeInput.value.length === 6) void verify();
});
$("codeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  void verify();
});
resendBtn.addEventListener("click", () => void sendCode(resendBtn, "codeError"));
$("changePhone").addEventListener("click", () => {
  window.clearInterval(timer);
  confirmation = null;
  show("phone");
});

/* ---------- join (not in Poster yet) ---------- */
const joinBtn = $<HTMLButtonElement>("joinSubmit");
$<HTMLInputElement>("joinBirthday").max = new Date().toISOString().slice(0, 10);

$("joinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>("joinName").value.trim();
  const birthday = $<HTMLInputElement>("joinBirthday").value || undefined;
  busy(joinBtn, true);
  setError("joinError", null);
  try {
    const { data } = await api.registerMe({ name, ...(birthday ? { birthday } : {}) });
    if (data.loyalty.exists) await renderCabinet(data.loyalty);
    else setError("joinError", "Не вдалося створити картку. Спробуйте ще раз.");
  } catch (err) {
    setError("joinError", err);
  } finally {
    busy(joinBtn, false);
  }
});

/* ---------- cabinet ---------- */
async function renderCabinet(l: Loyalty, phone = auth.currentUser?.phoneNumber ?? "") {
  const name = firstName(l.name);
  $("cabHello").textContent = name ? `Привіт, ${name}!` : "Привіт!";
  $("cabBonus").textContent = uah(l.bonusUah);
  $("cabProgram").textContent =
    l.program === "discount" ? `Ваша знижка — ${l.percent}%` : `Повертаємо ${l.percent}% бонусами з кожної покупки`;
  $("cabGroup").textContent = l.groupName;
  $("cabGroup").hidden = !l.groupName;
  $("cabPhone").textContent = prettyPhone(phone);
  $("cabTotal").textContent = uah(l.totalPaidUah);

  const list = $("cabHistory");
  list.innerHTML = "";
  for (const p of l.purchases) {
    const li = document.createElement("li");
    const when = document.createElement("span");
    when.className = "h-date";
    when.textContent = purchaseDate(p.closedAt);
    const sum = document.createElement("b");
    sum.className = "h-sum";
    sum.textContent = uah(p.totalUah);
    li.append(when, sum);
    if (p.paidWithBonusUah > 0) {
      const b = document.createElement("small");
      b.className = "h-bonus";
      b.textContent = `з них бонусами ${uah(p.paidWithBonusUah)}`;
      li.append(b);
    }
    list.append(li);
  }
  $("cabEmpty").hidden = l.purchases.length > 0;

  if (phone) {
    await QRCode.toCanvas($<HTMLCanvasElement>("cabQr"), phone, { width: 200, margin: 1, color: { dark: "#3B2415", light: "#ffffff" } });
  }
  show("cabinet");
}

async function loadCabinet() {
  show("loading");
  try {
    const { data } = await api.getMyLoyalty();
    if (data.exists) await renderCabinet(data);
    else show("join");
  } catch (err) {
    setError("failedText", err);
    show("failed");
  }
}

$("retry").addEventListener("click", () => void loadCabinet());
$("logout").addEventListener("click", () => void signOut(auth));
$("failedLogout").addEventListener("click", () => void signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (!user) {
    national = "";
    renderPhone();
    show("phone");
  } else if (!user.phoneNumber) {
    void signOut(auth);
  } else {
    window.clearInterval(timer);
    void loadCabinet();
  }
});

// Dev-only hook for visual checks of every screen (stripped from production builds).
if (import.meta.env.DEV) {
  Object.assign(window, { __account: { show, renderCabinet, setError } });
}
