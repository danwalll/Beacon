// ── Lemon Squeezy checkout ──────────────────────────────────────────
// Paste your real checkout URL here after creating the product:
//   https://beacon.lemonsqueezy.com/checkout/buy/YOUR_PRODUCT_ID
const CHECKOUT_URL =
  "https://beacon.lemonsqueezy.com/checkout/buy/PLACEHOLDER";

// Wire buy buttons
for (const btn of document.querySelectorAll("#buy, #buy-bottom, #buy-nav")) {
  btn.href = CHECKOUT_URL;
}

// ── Orb demo cycle ────────────────────────────────────────────────
const ORB_STATES = [
  { id: "gray", label: "Idle — no agent running" },
  { id: "amber", label: "Working — agent is thinking" },
  { id: "rose", label: "Needs you — waiting for input" },
  { id: "green", label: "Done — task finished" },
];

const orbDemo = document.getElementById("orb-demo");
const demoLabel = document.getElementById("demo-label");
const stateCards = document.querySelectorAll(".state-card");
const menubarBeacon = document.querySelector(".menubar-beacon");
let stateIndex = 0;

function setOrbState(index) {
  const state = ORB_STATES[index];
  orbDemo.dataset.state = state.id;
  demoLabel.textContent = state.label;

  stateCards.forEach((card) => {
    card.classList.toggle("active", card.dataset.state === state.id);
  });

  if (menubarBeacon) {
    const root = document.documentElement;
    const color = getComputedStyle(root)
      .getPropertyValue(`--${state.id}`)
      .trim();
    const glow = getComputedStyle(root)
      .getPropertyValue(`--${state.id}-glow`)
      .trim();
    menubarBeacon.style.background = color;
    menubarBeacon.style.boxShadow = `0 0 6px ${glow}`;
  }
}

function cycleOrb() {
  stateIndex = (stateIndex + 1) % ORB_STATES.length;
  setOrbState(stateIndex);
}

setOrbState(0);
setInterval(cycleOrb, 2800);

// ── ROI calculator ────────────────────────────────────────────────
const PRICE = 3.99;
const DELAY_MIN = 4;
const WORK_DAYS = 250;

const sessions = document.getElementById("sessions");
const sessionsOut = document.getElementById("sessions-out");
const savingsEl = document.getElementById("savings");
const savingsDetailEl = document.getElementById("savings-detail");
const roiEl = document.getElementById("roi");
const ratePills = document.querySelectorAll(".rate-pill");

let hourly = 100;

function money(n) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function recalc() {
  const sessionsPerDay = Number(sessions.value);
  sessionsOut.textContent = String(sessionsPerDay);

  const hoursLost = (sessionsPerDay * WORK_DAYS * DELAY_MIN) / 60;
  const dollars = hoursLost * hourly;
  const roi = Math.max(1, Math.round(dollars / PRICE));

  savingsEl.textContent = money(dollars);
  savingsDetailEl.textContent = `recovered per year · ~${Math.round(hoursLost)} hours back`;
  roiEl.textContent =
    roi >= 1000 ? `${Math.round(roi / 100) / 10}k×` : `${roi}×`;
}

sessions.addEventListener("input", recalc);

for (const pill of ratePills) {
  pill.addEventListener("click", () => {
    for (const p of ratePills) p.classList.remove("is-active");
    pill.classList.add("is-active");
    hourly = Number(pill.dataset.rate);
    recalc();
  });
}

recalc();
