// Lemon Squeezy checkout: getbeacon.lemonsqueezy.com
const CHECKOUT_URL =
  "https://getbeacon.lemonsqueezy.com/checkout/buy/84c2b343-6b5b-41b8-8a46-ce42cd010072";

// Wire buy buttons
for (const btn of document.querySelectorAll("#buy, #buy-bottom, #buy-nav")) {
  btn.href = CHECKOUT_URL;
}

const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)"
).matches;

// Orb demo
const ORB_STATES = [
  { id: "gray", label: "Idle. No background agent." },
  { id: "amber", label: "Running. You are somewhere else." },
  { id: "rose", label: "Blocked. Approval needed." },
  { id: "green", label: "Done. Time to come back." },
];

const orbDemo = document.getElementById("orb-demo");
const demoLabel = document.getElementById("demo-label");
const menubarBeacon =
  document.getElementById("menubar-beacon") ||
  document.querySelector(".menubar-beacon");
let stateIndex = 0;
let orbTimer = null;

function orbColors(stateId) {
  const root = document.documentElement;
  return {
    color: getComputedStyle(root).getPropertyValue(`--${stateId}`).trim(),
    glow: getComputedStyle(root).getPropertyValue(`--${stateId}-glow`).trim(),
  };
}

function setOrbState(index) {
  const state = ORB_STATES[index];
  orbDemo.dataset.state = state.id;
  orbDemo.classList.toggle("is-done", state.id === "green");
  orbDemo.classList.toggle("is-working", state.id === "amber");

  demoLabel.classList.add("is-changing");
  window.setTimeout(() => {
    demoLabel.textContent = state.label;
    demoLabel.classList.remove("is-changing");
  }, prefersReducedMotion ? 0 : 140);

  if (menubarBeacon) {
    const { color, glow } = orbColors(state.id);
    menubarBeacon.style.background = color;
    menubarBeacon.style.boxShadow = `0 0 8px ${glow}`;
    menubarBeacon.classList.toggle("is-ping", state.id === "green");
  }

  if (state.id === "green" && !prefersReducedMotion) {
    orbDemo.classList.remove("is-celebrate");
    void orbDemo.offsetWidth;
    orbDemo.classList.add("is-celebrate");
  }
}

function cycleOrb() {
  stateIndex = (stateIndex + 1) % ORB_STATES.length;
  setOrbState(stateIndex);
}

function startOrbAutoplay() {
  if (orbTimer) clearInterval(orbTimer);
  orbTimer = window.setInterval(cycleOrb, 3200);
}

setOrbState(0);
startOrbAutoplay();

orbDemo.addEventListener("click", () => {
  cycleOrb();
  startOrbAutoplay();
});

// Scroll reveals
for (const el of document.querySelectorAll(".reveal-on-scroll")) {
  el.classList.add("is-waiting");
}

if (!prefersReducedMotion && "IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        entry.target.classList.remove("is-waiting");
        revealObserver.unobserve(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );

  for (const el of document.querySelectorAll(".reveal-on-scroll")) {
    revealObserver.observe(el);
  }
} else {
  for (const el of document.querySelectorAll(".reveal-on-scroll")) {
    el.classList.add("is-visible");
    el.classList.remove("is-waiting");
  }
}

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

function bumpResult(el, nextValue) {
  if (prefersReducedMotion || el.textContent === nextValue) return;
  el.classList.remove("result-bump");
  void el.offsetWidth;
  el.classList.add("result-bump");
}

function recalc() {
  const sessionsPerDay = Number(sessions.value);
  const noticeMin = Number(notice.value);
  sessionsOut.textContent = String(sessionsPerDay);
  noticeOut.textContent = `${noticeMin} min`;

  const hoursLost = (sessionsPerDay * WORK_DAYS * noticeMin) / 60;
  const hourly = readHourly();
  const dollars = hoursLost * hourly;
  const savingsText = money(dollars);
  const hoursText = String(Math.round(hoursLost));

  bumpResult(savingsEl, savingsText);
  bumpResult(hoursEl, hoursText);
  savingsEl.textContent = savingsText;
  hoursEl.textContent = hoursText;
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
