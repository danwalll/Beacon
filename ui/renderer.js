const beaconEl = document.getElementById("beacon");
const shellEl = document.getElementById("shell");
const tickerEl = document.getElementById("ticker");
const trackEl = document.getElementById("ticker-track");
let clickLock = false;

const NAMES = {
  cursor: "Cursor",
  codex: "ChatGPT",
  claude: "Claude",
  http: "Custom",
  home: "",
};

function displayName(source) {
  return NAMES[source] || (source ? String(source) : "Agent");
}

function setLabel(text) {
  if (!text) {
    tickerEl.hidden = true;
    tickerEl.classList.remove("is-scrolling");
    trackEl.replaceChildren();
    return;
  }

  tickerEl.hidden = false;
  const span = document.createElement("span");
  span.className = "ticker-text";
  span.textContent = text;
  trackEl.replaceChildren(span);

  requestAnimationFrame(() => {
    const needsScroll = span.scrollWidth > tickerEl.clientWidth + 1;
    tickerEl.classList.toggle("is-scrolling", needsScroll);
    if (!needsScroll) {
      trackEl.replaceChildren(span);
      return;
    }
    const dup = span.cloneNode(true);
    dup.setAttribute("aria-hidden", "true");
    span.textContent = `${text}   ·   `;
    dup.textContent = `${text}   ·   `;
    trackEl.replaceChildren(span, dup);
  });
}

function applyStatus(status) {
  const state = status?.state || "idle";
  const source = status?.orbSource || status?.source || window.beacon.orbSource;
  beaconEl.classList.remove("idle", "working", "action", "done", "is-clickable");
  beaconEl.classList.add(state);
  const clickable = state === "done" || state === "action";
  if (clickable) {
    beaconEl.classList.add("is-clickable");
    shellEl?.classList.add("is-clickable");
  } else {
    shellEl?.classList.remove("is-clickable");
  }

  const who = displayName(source);
  setLabel(state === "idle" ? "" : who);

  const setupHint = " Right-click for options.";
  beaconEl.setAttribute(
    "aria-label",
    state === "action"
      ? `${who} needs your answer. Click to focus.${setupHint}`
      : state === "done"
        ? `${who} finished. Click to focus.${setupHint}`
        : state === "working"
          ? `${who} working.${setupHint}`
          : `Beacon idle.${setupHint}`
  );
}

beaconEl.addEventListener("click", async (event) => {
  if (clickLock) return;
  const status = await window.beacon.getStatus();
  if (status.state !== "done" && status.state !== "action") return;

  event.preventDefault();
  event.stopPropagation();

  clickLock = true;
  try {
    const source =
      status.source || window.beacon.orbSource || status.orbSource || "cursor";
    await window.beacon.focusApp(source);
  } finally {
    setTimeout(() => {
      clickLock = false;
    }, 1500);
  }
});

// Native macOS menu — like right-clicking a desktop file
shellEl.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const source = window.beacon.orbSource || "home";
  window.beacon.showOrbMenu(source);
});

window.beacon.getStatus().then(applyStatus);
window.beacon.onStatus(applyStatus);
