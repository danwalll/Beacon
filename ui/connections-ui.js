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
  card.className = `card ${c.connected ? "is-on" : ""} ${
    c.recommended ? "is-recommended" : ""
  }`;

  const meta = document.createElement("div");
  meta.className = "meta";
  const badge = c.recommended
    ? '<p class="badge">Likely on your Mac</p>'
    : "";
  meta.innerHTML = `
    <h2>${escapeHtml(c.name)}</h2>
    ${badge}
    <p class="blurb">${escapeHtml(c.blurb)}</p>
    <p class="status ${c.connected ? "on" : "off"}">${
      c.connected ? "On" : "Off"
    }</p>
  `;

  const actions = document.createElement("div");
  actions.className = "actions";

  if (c.id === "http") {
    // Advanced section handled separately
    return null;
  }

  if (c.connected) {
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = "Turn off";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await window.beacon.disconnectWorkflow(c.id);
      await refresh();
    });
    actions.appendChild(btn);
  } else {
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Turn on";
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
    tip.className = "tip";
    tip.textContent = c.tip;
    card.appendChild(tip);
  }

  return card;
}

function makeAdvanced(http) {
  const wrap = document.createElement("details");
  wrap.className = "advanced";

  const summary = document.createElement("summary");
  summary.textContent = "Advanced — custom tools";
  wrap.appendChild(summary);

  const body = document.createElement("div");
  body.className = "advanced-body";
  body.innerHTML = `
    <p>
      Only needed if you’re wiring Beacon into a custom script. Most people can
      skip this.
    </p>
  `;

  if (http?.recipe) {
    const copyBtn = document.createElement("button");
    copyBtn.className = "ghost";
    copyBtn.textContent = "Copy “finished” command";
    copyBtn.addEventListener("click", async () => {
      await navigator.clipboard.writeText(http.recipe.done);
      copyBtn.textContent = "Copied";
      setTimeout(() => {
        copyBtn.textContent = "Copy “finished” command";
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
    <h2>Step 1: Add Beacon to Applications</h2>
    <p>One click — then you can open Beacon from Spotlight anytime (⌘Space → “Beacon”).</p>
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

  let http = null;
  for (const c of connections) {
    if (c.id === "http") {
      http = c;
      continue;
    }
    const card = makeCard(c);
    if (card) listEl.appendChild(card);
  }

  listEl.appendChild(makeAdvanced(http));
}

refresh();
