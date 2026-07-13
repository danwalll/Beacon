const listEl = document.getElementById("list");
const installBannerEl = document.getElementById("install-banner");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function makeCard(c) {
  const card = document.createElement("article");
  card.className = `card group-row ${c.connected ? "is-on" : ""} ${
    c.recommended ? "is-recommended" : ""
  }`;

  const meta = document.createElement("div");
  meta.className = "meta";
  const badge = c.recommended
    ? '<span class="badge">Likely on your Mac</span>'
    : "";
  meta.innerHTML = `
    <p class="group-row__title">${escapeHtml(c.name)} ${badge}</p>
    <p class="group-row__body">${escapeHtml(c.blurb)}</p>
    <p class="group-row__meta status-pill ${c.connected ? "is-on" : ""}">${
      c.connected ? "On" : "Off"
    }</p>
  `;

  const actions = document.createElement("div");
  actions.className = "group-row__aside actions";

  if (c.id === "http") {
    return null;
  }

  if (c.connected) {
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = "Turn Off";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await window.beacon.disconnectWorkflow(c.id);
      await refresh();
    });
    actions.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Turn On";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await window.beacon.connectWorkflow(c.id);
      await refresh();
    });
    actions.appendChild(btn);
  }

  card.appendChild(meta);
  card.appendChild(actions);

  if (c.connected && c.tip) {
    const tip = document.createElement("p");
    tip.className = "group-row__note";
    tip.textContent = c.tip;
    card.classList.add("group-row--stacked");
    card.appendChild(tip);
  }

  return card;
}

function makeAdvanced(http) {
  const wrap = document.createElement("details");
  wrap.className = "disclosure";

  const summary = document.createElement("summary");
  summary.textContent = "Advanced — custom tools";
  wrap.appendChild(summary);

  const body = document.createElement("div");
  body.className = "disclosure-body";
  body.innerHTML = `
    <p>
      Only needed if you’re wiring Beacon into a custom script. Most people can
      skip this.
    </p>
  `;

  if (http?.recipe) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "ghost";
    copyBtn.textContent = "Copy command";
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(http.recipe.done);
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy command";
      }, 1200);
    });
    body.appendChild(copyBtn);

    const pre = document.createElement("pre");
    pre.textContent = http.recipe.done;
    body.appendChild(pre);
  }

  wrap.appendChild(body);
  return wrap;
}

async function renderInstallBanner() {
  if (!installBannerEl || !window.beacon.getInstallStatus) return;
  const st = await window.beacon.getInstallStatus();
  if (!st.canInstall) {
    installBannerEl.hidden = true;
    installBannerEl.innerHTML = "";
    return;
  }

  installBannerEl.hidden = false;
  installBannerEl.innerHTML = `
    <h2>Add Beacon to Applications</h2>
    <p>One click — then open Beacon from Spotlight (⌘Space → “Beacon”).</p>
    <div class="actions"></div>
  `;
  const actions = installBannerEl.querySelector(".actions");
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = "Add to Applications";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Installing…";
    await window.beacon.installToApplications();
    btn.textContent = "Add to Applications";
    btn.disabled = false;
  });
  actions.appendChild(btn);
}

async function refresh() {
  await renderInstallBanner();
  const connections = await window.beacon.listConnections();
  listEl.innerHTML = "";

  const group = document.createElement("div");
  group.className = "group";

  let http = null;
  let hasRows = false;
  for (const c of connections) {
    if (c.id === "http") {
      http = c;
      continue;
    }
    const card = makeCard(c);
    if (card) {
      group.appendChild(card);
      hasRows = true;
    }
  }

  if (hasRows) {
    listEl.appendChild(group);
  }

  listEl.appendChild(makeAdvanced(http));
}

refresh();
