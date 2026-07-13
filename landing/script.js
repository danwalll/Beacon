// Lemon Squeezy checkout: getbeacon.lemonsqueezy.com
const CHECKOUT_URL =
  "https://getbeacon.lemonsqueezy.com/checkout/buy/84c2b343-6b5b-41b8-8a46-ce42cd010072";

// Wire buy buttons
for (const btn of document.querySelectorAll("#buy, #buy-bottom, #buy-nav")) {
  btn.href = CHECKOUT_URL;
}

// ── Orb demo cycle ────────────────────────────────────────────────
const ORB_STATES = [
  { id: "gray", label: "Idle. No background agent." },
  { id: "amber", label: "Running. You are somewhere else." },
  { id: "rose", label: "Blocked. Approval needed." },
  { id: "green", label: "Done. Time to come back." },
];

const orbDemo = document.getElementById("orb-demo");
const demoLabel = document.getElementById("demo-label");
const menubarBeacon = document.querySelector(".menubar-beacon");
let stateIndex = 0;

function setOrbState(index) {
  const state = ORB_STATES[index];
  orbDemo.dataset.state = state.id;
  demoLabel.textContent = state.label;

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

// Calculator
const WORK_DAYS = 250;

const sessions = document.getElementById("sessions");
const notice = document.getElementById("notice");
const sessionsOut = document.getElementById("sessions-out");
const noticeOut = document.getElementById("notice-out");
const savingsEl = document.getElementById("savings");
const hoursEl = document.getElementById("hours");
const hourlyInput = document.getElementById("hourly");
const ratePills = document.querySelectorAll(".rate-pill");

function syncRatePills(value) {
  let matched = false;
  for (const pill of ratePills) {
    const isMatch = Number(pill.dataset.rate) === value;
    pill.classList.toggle("is-active", isMatch);
    if (isMatch) matched = true;
  }
  if (!matched) {
    for (const pill of ratePills) pill.classList.remove("is-active");
  }
}

function readHourly() {
  const value = Number(hourlyInput.value);
  if (!Number.isFinite(value)) return 100;
  return Math.min(500, Math.max(25, Math.round(value)));
}

function money(n) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function recalc() {
  const sessionsPerDay = Number(sessions.value);
  const noticeMin = Number(notice.value);
  sessionsOut.textContent = String(sessionsPerDay);
  noticeOut.textContent = `${noticeMin} min`;

  const hoursLost = (sessionsPerDay * WORK_DAYS * noticeMin) / 60;
  const hourly = readHourly();
  const dollars = hoursLost * hourly;

  savingsEl.textContent = money(dollars);
  hoursEl.textContent = String(Math.round(hoursLost));
}

sessions.addEventListener("input", recalc);
notice.addEventListener("input", recalc);

hourlyInput.addEventListener("input", () => {
  syncRatePills(readHourly());
  recalc();
});

hourlyInput.addEventListener("blur", () => {
  hourlyInput.value = String(readHourly());
  syncRatePills(readHourly());
  recalc();
});

for (const pill of ratePills) {
  pill.addEventListener("click", () => {
    const rate = Number(pill.dataset.rate);
    hourlyInput.value = String(rate);
    syncRatePills(rate);
    recalc();
  });
}

recalc();
