const beaconEl = document.getElementById("beacon");
const labelEl = document.getElementById("label");
let clickLock = false;

function applyStatus(status) {
  const state = status?.state || "idle";
  beaconEl.classList.remove("idle", "working", "action", "done");
  beaconEl.classList.add(state);

  if (state === "working") {
    labelEl.textContent = "work";
  } else if (state === "action") {
    labelEl.textContent = "ask";
  } else if (state === "done") {
    labelEl.textContent = "done";
  } else {
    labelEl.textContent = "";
  }

  beaconEl.setAttribute(
    "aria-label",
    state === "action"
      ? "Agent needs your answer. Click to focus."
      : state === "done"
        ? `Agent finished${status.source ? ` in ${status.source}` : ""}. Click to focus.`
        : state === "working"
          ? `Agent working${status.source ? ` in ${status.source}` : ""}`
          : "Beacon idle"
  );
}

beaconEl.addEventListener("click", async () => {
  if (clickLock) return;
  const status = await window.beacon.getStatus();
  if (status.state !== "done" && status.state !== "action") return;

  clickLock = true;
  try {
    await window.beacon.focusApp("cursor");
  } finally {
    setTimeout(() => {
      clickLock = false;
    }, 1500);
  }
});

beaconEl.addEventListener("contextmenu", async (event) => {
  event.preventDefault();
  const status = await window.beacon.getStatus();
  if (status.state === "idle") {
    await window.beacon.setStatus({
      state: "working",
      source: "cursor",
      label: "Beacon",
      workspaceRoot: "/Users/danwall/Beacon",
    });
  } else if (status.state === "working") {
    await window.beacon.setStatus({
      state: "action",
      source: "cursor",
      label: status.label || "Beacon",
      workspaceRoot: status.workspaceRoot || "/Users/danwall/Beacon",
    });
  } else if (status.state === "action") {
    await window.beacon.setStatus({
      state: "done",
      source: "cursor",
      label: status.label || "Beacon",
      workspaceRoot: status.workspaceRoot || "/Users/danwall/Beacon",
    });
  } else {
    await window.beacon.ack();
  }
});

window.beacon.getStatus().then(applyStatus);
window.beacon.onStatus(applyStatus);
