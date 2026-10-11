/*
 * SSDOJ character select NUI.
 *
 * Lua -> NUI (SendNUIMessage):
 *   { action: "open", characters, isAdmin, aop, priority, peacetime, online, maxPlayers,
 *     departments?, spawns? }
 *   { action: "setCharacters", characters }
 *   { action: "setStatus", aop?, priority?, peacetime?, online?, maxPlayers? }
 *   { action: "close" }
 *
 * NUI -> Lua (RegisterNUICallback, always respond with a table):
 *   createCharacter { character, spawn }  -> { id }
 *   editCharacter   { character }
 *   deleteCharacter { id }
 *   playCharacter   { id, spawn }
 *   previewSpawn    { spawn }              -- fired on hover, move the camera there
 *   getCrimeHistory { id }                 -> { records: [...], licenses: [...] }
 *   disconnect      {}
 *   adminGetData    {}                     -> { players, characters, bans, logs, uptime, weather, time,
 *                                               freezeTime, blackout }
 *   adminAction     { action, ... }        -> { ok = false, error = "..." } to reject
 *
 * Character: { id, firstName, lastName, dob, gender, department, owner? }
 * Record:    { id, type: "Citation"|"Arrest"|"Warrant"|"Warning", date, charges: [], officer,
 *              agency, fine, jail (months), status }
 * License:   { name, status: "Valid"|"Suspended"|"Revoked"|"None" }
 */

const isBrowser = typeof GetParentResourceName !== "function";
const resource = isBrowser ? "ssdoj-characters" : GetParentResourceName();

const state = {
  characters: [],
  isAdmin: false,
  aop: "Los Santos",
  priority: "Available",
  peacetime: false,
  online: 0,
  maxPlayers: 64,
  departments: ["CIV", "LSPD", "BCSO", "SAHP", "SAFR", "DOT"],
  // Spawns per department. "ALL" is appended to every list.
  spawns: {
    ALL:  [{ id: "last", name: "Last Location", area: "Where you logged off", icon: "📍" }],
    CIV:  [
      { id: "legion",   name: "Legion Square",           area: "Los Santos",    icon: "🏙️" },
      { id: "airport",  name: "LS International Airport", area: "Los Santos",   icon: "✈️" },
      { id: "sandy",    name: "Sandy Shores",            area: "Blaine County", icon: "🏜️" },
      { id: "paleto",   name: "Paleto Bay",              area: "Blaine County", icon: "🌲" },
    ],
    LSPD: [
      { id: "missionrow", name: "Mission Row PD",  area: "Los Santos", icon: "🚓" },
      { id: "vespucci",   name: "Vespucci PD",     area: "Los Santos", icon: "🚓" },
      { id: "vinewood",   name: "Vinewood PD",     area: "Los Santos", icon: "🚓" },
      { id: "davis",      name: "Davis Sheriff Station", area: "Los Santos", icon: "🚓" },
    ],
    BCSO: [
      { id: "sandyso",  name: "Sandy Shores SO", area: "Blaine County", icon: "⭐" },
      { id: "paletoso", name: "Paleto Bay SO",   area: "Blaine County", icon: "⭐" },
    ],
    SAHP: [
      { id: "sahphq",  name: "SAHP Headquarters", area: "Los Santos", icon: "🏍️" },
      { id: "route68", name: "Route 68 Station",  area: "Harmony",    icon: "🏍️" },
    ],
    SAFR: [
      { id: "fs7",     name: "Fire Station 7",   area: "Los Santos",    icon: "🚒" },
      { id: "pillbox", name: "Pillbox Medical",  area: "Los Santos",    icon: "🚑" },
      { id: "sandyfd", name: "Sandy Shores FD",  area: "Blaine County", icon: "🚒" },
    ],
    DOT: [{ id: "dotyard", name: "DOT Yard", area: "La Mesa", icon: "🚧" }],
  },
};

const DEPT_COLORS = {
  CIV: "#6b7280", LSPD: "#2563eb", BCSO: "#a16207", SAHP: "#0f766e", SAFR: "#b91c1c", DOT: "#c2410c",
};
const PRIORITY_COLORS = { Available: "#4caf50", Active: "#d9534f", Hold: "#e0a030", Cooldown: "#3b82f6" };
const RECORD_COLORS = { Citation: "#e0a030", Arrest: "#d9534f", Warrant: "#a855f7", Warning: "#3b82f6" };
const LICENSE_COLORS = { Valid: "#4caf50", Suspended: "#e0a030", Revoked: "#d9534f", None: "#8a8a90" };
const AOP_PRESETS = ["Los Santos", "Blaine County", "San Andreas", "Sandy Shores", "Paleto Bay", "Vinewood", "Mirror Park"];
const WEATHERS = ["EXTRASUNNY", "CLEAR", "CLOUDS", "OVERCAST", "RAIN", "THUNDER", "FOGGY", "SNOW", "XMAS", "HALLOWEEN"];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $("#app");
const modalRoot = $("#modals");

/* ================= NUI bridge ================= */

async function post(event, data = {}) {
  if (isBrowser) {
    console.log("[NUI ->]", event, data);
    return mockResponse(event, data);
  }
  try {
    const res = await fetch(`https://${resource}/${event}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(data),
    });
    return (await res.json().catch(() => ({}))) || {};
  } catch {
    return {};
  }
}

const STATUS_KEYS = ["aop", "priority", "peacetime", "online", "maxPlayers"];

window.addEventListener("message", ({ data }) => {
  switch (data.action) {
    case "open":
      for (const k of [...STATUS_KEYS, "isAdmin", "departments", "spawns"]) {
        if (data[k] !== undefined) state[k] = data[k];
      }
      state.characters = data.characters || [];
      openUI();
      break;
    case "setCharacters":
      state.characters = data.characters || [];
      renderList();
      break;
    case "setStatus":
      for (const k of STATUS_KEYS) if (data[k] !== undefined) state[k] = data[k];
      renderStatus();
      break;
    case "close":
      closeUI();
      break;
  }
});

function openUI() {
  app.classList.remove("hidden");
  renderStatus();
  renderList();
}

function closeUI() {
  app.classList.add("hidden");
  modalRoot.innerHTML = "";
}

/* ================= main panel ================= */

function renderStatus() {
  $("#aop-value").textContent = state.aop;
  const pr = $("#priority-value");
  pr.textContent = state.priority;
  pr.style.setProperty("--c", PRIORITY_COLORS[state.priority] || "#fff");
  const pt = $("#peace-value");
  pt.textContent = state.peacetime ? "On" : "Off";
  pt.style.setProperty("--c", state.peacetime ? "#4caf50" : "#d9534f");
  $("#online-value").textContent = `${state.online} / ${state.maxPlayers}`;
  $("#btn-admin").classList.toggle("hidden", !state.isAdmin);
}

const ICONS = {
  play: `<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>`,
  edit: `<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>`,
  history: `<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7"/></svg>`,
  trash: `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
};

function renderList() {
  const list = $("#char-list");
  $("#char-count").textContent = state.characters.length;
  if (!state.characters.length) {
    list.innerHTML = `<p class="empty">You have no characters yet.<br>Hit <b>Create Character</b> to get started.</p>`;
    return;
  }
  list.innerHTML = state.characters.map((c, i) => `
    <div class="char-card" data-id="${esc(c.id)}" style="--c:${DEPT_COLORS[c.department] || "#6b7280"};animation-delay:${i * 50}ms">
      <div class="char-main">
        <div class="avatar">${esc(initials(c))}</div>
        <div class="char-info">
          ${marquee(fullName(c), "char-name")}
          <div class="char-sub">${deptChip(c.department)}${c.dob ? `<span>DOB ${esc(c.dob)}</span>` : ""}</div>
        </div>
        <button class="play-btn" data-act="play">${ICONS.play}Play</button>
      </div>
      <div class="char-actions">
        <button class="edit" data-act="edit">${ICONS.edit}Edit</button>
        <button class="history" data-act="history">${ICONS.history}Crime History</button>
        <button class="danger" data-act="delete">${ICONS.trash}Delete</button>
      </div>
    </div>`).join("");
  applyMarquee(list);
}

$("#char-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const c = state.characters.find((x) => String(x.id) === btn.closest(".char-card").dataset.id);
  if (!c) return;
  if (btn.dataset.act === "play") openSpawnModal(c);
  if (btn.dataset.act === "edit") openCharacterModal(c);
  if (btn.dataset.act === "history") openCrimeHistory(c);
  if (btn.dataset.act === "delete") deleteCharacter(c);
});

function tickClock() {
  const now = new Date();
  $("#clock-time").textContent = now.toTimeString().slice(0, 5);
  $("#clock-date").textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
tickClock();
setInterval(tickClock, 10000);

$("#btn-create").onclick = () => openCharacterModal();
$("#btn-admin").onclick = () => openAdmin();
$("#btn-disconnect").onclick = async () => {
  if (await confirmModal({ title: "Disconnect?", text: "You will be disconnected from the server.", confirmLabel: "Disconnect", danger: true })) {
    post("disconnect");
  }
};

/* ================= modal system ================= */

function openModal({ title, body, footer = "", size = "", onAction }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal ${size}" role="dialog">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="modal-x" data-act="close" aria-label="Close">✕</button>
      </header>
      <div class="modal-body">${body}</div>
      ${footer ? `<footer class="modal-foot">${footer}</footer>` : ""}
    </div>`;
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) closeModal(wrap); });
  wrap.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    if (btn.dataset.act === "close") closeModal(wrap);
    else if (onAction) onAction(btn.dataset.act, btn, wrap);
  });
  modalRoot.appendChild(wrap);
  applyMarquee(wrap);
  return wrap;
}

function closeModal(wrap = modalRoot.lastElementChild) {
  if (!wrap) return;
  if (wrap.onClose) wrap.onClose();
  wrap.remove();
}

// Resolves to the values of any [name] fields (or {}) on confirm, null on cancel.
function confirmModal({ title, text, confirmLabel = "Confirm", danger = false, fields = "" }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title,
      size: "small",
      body: `<p class="modal-text">${esc(text)}</p>${fields ? `<div class="form">${fields}</div>` : ""}`,
      footer: `
        <button class="btn btn-ghost" data-act="close">Cancel</button>
        <button class="btn ${danger ? "btn-delete" : "btn-primary"}" data-act="ok">${esc(confirmLabel)}</button>`,
      onAction: (act) => {
        if (act !== "ok") return;
        const missing = $$("[required]", m).find((i) => !i.value.trim());
        if (missing) return flash(missing);
        done = true;
        resolve(Object.fromEntries($$("[name]", m).map((i) => [i.name, i.value.trim()])));
        closeModal(m);
      },
    });
    m.onClose = () => { if (!done) resolve(null); };
    const first = $("input, textarea", m);
    if (first) first.focus();
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

/* ================= create / edit ================= */

function openCharacterModal(character = null, { admin = false, onSaved } = {}) {
  const editing = !!character;
  const withSpawn = !editing && !admin;
  let spawn = null;

  const deptOptions = state.departments
    .map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");

  const m = openModal({
    title: editing ? `Edit ${fullName(character)}` : "Create Character",
    size: withSpawn ? "" : "small",
    body: `
      <form class="form" autocomplete="off">
        ${admin && !editing ? `<label>Owner (server ID or license)<input name="owner" required placeholder="e.g. 12 or license:abc123"></label>` : ""}
        <div class="row">
          <label>First name<input name="firstName" required maxlength="24"></label>
          <label>Last name<input name="lastName" required maxlength="24"></label>
        </div>
        <div class="row">
          <label>Date of birth<input name="dob" type="date" required></label>
          <label>Gender
            <select name="gender"><option>Male</option><option>Female</option><option>Other</option></select>
          </label>
        </div>
        <label>Department<select name="department">${deptOptions}</select></label>
        ${withSpawn ? `<div class="field-label">Spawn location<div class="spawn-grid"></div></div>` : ""}
        <button type="submit" hidden></button>
      </form>`,
    footer: `
      <button class="btn btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-primary" data-act="save">${editing ? "Save Changes" : withSpawn ? "Create & Spawn" : "Create"}</button>`,
    onAction: (act) => { if (act === "save") save(); },
  });

  const form = $("form", m);
  if (editing) {
    for (const key of ["firstName", "lastName", "dob", "gender", "department"]) {
      if (character[key] != null) form.elements[key].value = character[key];
    }
  }

  const refreshSpawns = () => {
    if (!withSpawn) return;
    spawn = null;
    renderSpawns($(".spawn-grid", m), spawnsFor(form.elements.department.value), (s) => (spawn = s));
  };
  form.elements.department.addEventListener("change", refreshSpawns);
  refreshSpawns();
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  form.elements[admin && !editing ? "owner" : "firstName"].focus();

  async function save() {
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    data.firstName = data.firstName.trim();
    data.lastName = data.lastName.trim();

    if (withSpawn && !spawn) {
      toast("Pick a spawn location first", "error");
      return flash($(".spawn-grid", m));
    }

    if (editing) {
      const updated = { ...character, ...data };
      const res = admin
        ? await post("adminAction", { action: "editCharacter", character: updated })
        : await post("editCharacter", { character: updated });
      if (res.ok === false) return toast(res.error || "Could not save character", "error");
      Object.assign(character, data);
      syncOwnCharacter(updated);
      toast(`Saved ${fullName(updated)}`);
      closeModal(m);
      if (onSaved) onSaved(character);
      return;
    }

    if (admin) {
      const res = await post("adminAction", { action: "createCharacter", character: data });
      if (res.ok === false) return toast(res.error || "Could not create character", "error");
      data.id = res.id != null ? res.id : Date.now();
      toast(`Created ${fullName(data)}`);
      closeModal(m);
      if (onSaved) onSaved(data);
      return;
    }

    const res = await post("createCharacter", { character: data, spawn });
    if (res.ok === false) return toast(res.error || "Could not create character", "error");
    data.id = res.id != null ? res.id : Date.now();
    state.characters.push(data);
    closeUI();
  }
}

// Keep the player's own list in step when an admin edits one of their characters.
function syncOwnCharacter(c) {
  const own = state.characters.find((x) => x.id === c.id);
  if (own) Object.assign(own, c);
  renderList();
}

async function deleteCharacter(c) {
  const ok = await confirmModal({
    title: "Delete character?",
    text: `${fullName(c)} (${c.department}) will be permanently deleted. This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  const res = await post("deleteCharacter", { id: c.id });
  if (res.ok === false) return toast(res.error || "Could not delete character", "error");
  state.characters = state.characters.filter((x) => x.id !== c.id);
  renderList();
  toast(`Deleted ${fullName(c)}`);
}

/* ================= spawn selector ================= */

function spawnsFor(dept) {
  return [...(state.spawns[dept] || state.spawns.CIV || []), ...(state.spawns.ALL || [])];
}

function renderSpawns(container, list, onSelect) {
  container.innerHTML = list.map((s, i) => `
    <button type="button" class="spawn" data-i="${i}">
      <span class="spawn-icon">${esc(s.icon || "📍")}</span>
      <span class="spawn-text">
        ${marquee(s.name, "spawn-name")}
        <span class="spawn-area">${esc(s.area || "")}</span>
      </span>
    </button>`).join("");
  $$(".spawn", container).forEach((el) => {
    const s = list[el.dataset.i];
    el.onmouseenter = () => post("previewSpawn", { spawn: s });
    el.onclick = () => {
      $$(".spawn", container).forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      onSelect(s);
    };
  });
  applyMarquee(container);
}

function openSpawnModal(c) {
  let chosen = null;
  const m = openModal({
    title: "Choose Spawn Location",
    body: `
      <div class="modal-sub">${esc(fullName(c))} ${deptChip(c.department)}</div>
      <div class="spawn-grid"></div>`,
    footer: `
      <button class="btn btn-ghost" data-act="close">Cancel</button>
      <button class="btn btn-primary" data-act="spawn" disabled>Spawn</button>`,
    onAction: async (act) => {
      if (act !== "spawn" || !chosen) return;
      const res = await post("playCharacter", { id: c.id, spawn: chosen });
      if (res.ok === false) return toast(res.error || "Could not spawn", "error");
      closeUI();
    },
  });
  renderSpawns($(".spawn-grid", m), spawnsFor(c.department), (s) => {
    chosen = s;
    $('[data-act="spawn"]', m).disabled = false;
  });
}

/* ================= crime history ================= */

async function openCrimeHistory(c, { admin = false } = {}) {
  const data = await post("getCrimeHistory", { id: c.id });
  const records = data.records || [];
  const licenses = data.licenses || [];
  let filter = "All";

  const m = openModal({
    title: "Crime History",
    size: "medium",
    body: `<div class="ch"></div>`,
    footer: `<button class="btn btn-ghost" data-act="close">Close</button>`,
    onAction: async (act, btn) => {
      if (act === "filter") {
        filter = btn.dataset.type;
        render();
      }
      if (act === "expunge") {
        const r = records.find((x) => String(x.id) === btn.dataset.rid);
        const ok = await confirmModal({
          title: "Expunge record?",
          text: `Remove ${r.type.toLowerCase()} ${r.id} from ${fullName(c)}'s record?`,
          confirmLabel: "Expunge",
          danger: true,
        });
        if (!ok) return;
        const res = await post("adminAction", { action: "expungeRecord", characterId: c.id, recordId: r.id });
        if (res.ok === false) return toast(res.error || "Could not expunge record", "error");
        records.splice(records.indexOf(r), 1);
        toast(`Expunged ${r.id}`);
        render();
      }
    },
  });

  function render() {
    const by = (t) => records.filter((r) => r.type === t);
    const fines = sum(records, "fine");
    const unpaid = sum(records.filter((r) => r.status === "Unpaid"), "fine");
    const jail = sum(records, "jail");
    const warrants = by("Warrant").filter((r) => r.status === "Active");
    const shown = filter === "All" ? records : by(filter);
    const tabs = ["All", "Citation", "Arrest", "Warrant", "Warning"];

    $(".ch", m).innerHTML = `
      <div class="ch-head">
        <div>
          <div class="ch-name">${esc(fullName(c))}</div>
          <div class="ch-meta">DOB ${esc(c.dob || "Unknown")} · ${esc(c.gender || "")}</div>
        </div>
        ${deptChip(c.department)}
      </div>

      ${warrants.length ? `<div class="warrant-banner">⚠ ${warrants.length} active warrant${warrants.length > 1 ? "s" : ""} for arrest</div>` : ""}

      <div class="tiles">
        ${tile("Total Fines", money(fines), unpaid ? `${money(unpaid)} unpaid` : "All paid")}
        ${tile("Arrests", by("Arrest").length, "lifetime")}
        ${tile("Jail Time", `${jail} mo`, "served / sentenced")}
        ${tile("Citations", by("Citation").length, `${by("Warning").length} warnings`)}
      </div>

      ${licenses.length ? `<div class="licenses">${licenses.map((l) =>
        `<span class="lic" style="--c:${LICENSE_COLORS[l.status] || "#ddd"}">${esc(l.name)}<b>${esc(l.status)}</b></span>`).join("")}</div>` : ""}

      <div class="tabs">
        ${tabs.map((t) => `
          <button class="tab ${t === filter ? "active" : ""}" data-act="filter" data-type="${t}">
            ${t === "All" ? "All" : t + "s"}<span class="n">${t === "All" ? records.length : by(t).length}</span>
          </button>`).join("")}
      </div>

      ${shown.length ? shown.map((r) => `
        <div class="record" style="--c:${RECORD_COLORS[r.type] || "#888"}">
          <div class="record-top">
            <span class="type-badge">${esc(r.type)}</span>
            <span>${esc(r.id)}</span>
            <span>${esc(r.date)}</span>
            <span class="record-status" style="--c:${statusColor(r.status)}">${esc(r.status || "")}</span>
          </div>
          <ul class="record-charges">${(r.charges || []).map((ch) => `<li>${esc(ch)}</li>`).join("")}</ul>
          <div class="record-meta">
            <span>Officer <b>${esc(r.officer || "—")}</b>${r.agency ? ` · ${esc(r.agency)}` : ""}</span>
            ${r.fine ? `<span>Fine <b>${money(r.fine)}</b></span>` : ""}
            ${r.jail ? `<span>Jail <b>${r.jail} months</b></span>` : ""}
            ${admin ? `<button class="btn btn-xs danger" data-act="expunge" data-rid="${esc(r.id)}">Expunge</button>` : ""}
          </div>
        </div>`).join("")
      : `<div class="empty-state">${filter === "All" ? "Clean record. No fines, arrests or warrants on file." : `No ${filter.toLowerCase()}s on file.`}</div>`}
    `;
  }
  render();
}

function statusColor(s) {
  return { Unpaid: "#e0a030", Paid: "#4caf50", Active: "#d9534f", Served: "#8a8a90", Issued: "#3b82f6" }[s] || "#ddd";
}

/* ================= admin panel ================= */

async function openAdmin() {
  const data = await post("adminGetData");
  const admin = {
    players: [], characters: [], bans: [], logs: [],
    uptime: "—", weather: "CLEAR", time: 12, freezeTime: false, blackout: false,
    ...data,
  };
  let tab = "dashboard";

  const TABS = [
    { id: "dashboard",  label: "Dashboard",  ico: "📊" },
    { id: "players",    label: "Players",    ico: "👥", count: () => admin.players.length },
    { id: "characters", label: "Characters", ico: "🪪", count: () => admin.characters.length },
    { id: "bans",       label: "Bans",       ico: "⛔", count: () => admin.bans.length },
    { id: "world",      label: "World",      ico: "🌦️" },
    { id: "logs",       label: "Logs",       ico: "📜" },
  ];

  const m = openModal({
    title: "Admin Panel",
    size: "wide",
    body: `<nav class="admin-nav"></nav><div class="admin-content"></div>`,
    onAction,
  });
  const nav = $(".admin-nav", m);
  const content = $(".admin-content", m);

  function show(id) {
    tab = id;
    nav.innerHTML = TABS.map((t) => `
      <button class="admin-tab ${t.id === tab ? "active" : ""}" data-act="tab" data-tab="${t.id}">
        <span class="ico">${t.ico}</span>${t.label}${t.count ? `<span class="n">${t.count()}</span>` : ""}
      </button>`).join("");
    content.innerHTML = VIEWS[id]();
    content.scrollTop = 0;
    // Live search: rows carry a lowercase data-search string.
    $$("[data-search-input]", content).forEach((input) => {
      input.oninput = () => {
        const q = input.value.toLowerCase().trim();
        $$("[data-search]", content).forEach((row) => {
          row.classList.toggle("hidden", !!q && !row.dataset.search.includes(q));
        });
      };
    });
    const range = $("#adm-time", content);
    if (range) range.oninput = () => ($("#adm-time-label", content).textContent = hour(range.value));
    applyMarquee(content);
  }

  const VIEWS = {
    dashboard: () => `
      <h3>Dashboard</h3>
      <div class="tiles">
        ${tile("Players Online", `${state.online}/${state.maxPlayers}`, `${admin.players.length} loaded`)}
        ${tile("Characters", admin.characters.length, "in database")}
        ${tile("Active Bans", admin.bans.length, "")}
        ${tile("Uptime", admin.uptime, "since restart")}
      </div>

      <div class="grid-2 section">
        <div class="card">
          <div class="section-title">Area of Patrol</div>
          <div class="inline">
            <input id="adm-aop" value="${esc(state.aop)}" maxlength="40">
            <button class="btn btn-primary" data-act="setAop">Set AOP</button>
          </div>
          <div class="chips">
            ${AOP_PRESETS.map((p) => `<button class="chip ${p === state.aop ? "active" : ""}" data-act="aopPreset" data-value="${esc(p)}">${esc(p)}</button>`).join("")}
          </div>
        </div>

        <div class="card">
          <div class="section-title">Priority Status</div>
          <div class="seg">
            ${Object.entries(PRIORITY_COLORS).map(([p, col]) => `
              <button class="${p === state.priority ? "active" : ""}" style="--c:${col}" data-act="priority" data-value="${p}">${p}</button>`).join("")}
          </div>
          <div class="spaced section" style="margin-top:14px">
            <div>
              <div class="section-title" style="margin:0">Peacetime</div>
              <div class="hint">Blocks shooting and aggressive driving</div>
            </div>
            <button class="switch ${state.peacetime ? "on" : ""}" data-act="peacetime" aria-label="Toggle peacetime"></button>
          </div>
        </div>
      </div>

      <div class="card section">
        <div class="section-title">Server Announcement</div>
        <div class="inline" style="align-items:stretch">
          <textarea id="adm-announce" placeholder="Message shown to every player…" maxlength="250"></textarea>
          <button class="btn btn-primary" data-act="announce">Send</button>
        </div>
      </div>`,

    players: () => `
      <h3>Online Players</h3>
      <div class="toolbar">
        <input data-search-input placeholder="Search by name, character or ID…">
        <span class="count-label">${admin.players.length} online</span>
        <button class="btn btn-ghost" data-act="refresh">Refresh</button>
      </div>
      <table class="table">
        <thead><tr>
          <th style="width:44px">ID</th><th style="width:120px">Player</th><th>Character</th>
          <th style="width:62px">Dept</th><th style="width:54px">Ping</th><th style="width:380px">Actions</th>
        </tr></thead>
        <tbody>
          ${admin.players.map((p) => `
            <tr data-search="${esc(`${p.id} ${p.name} ${p.character || ""} ${p.department || ""}`.toLowerCase())}">
              <td class="muted">${esc(p.id)}</td>
              <td>${marquee(p.name)}</td>
              <td>${p.character ? marquee(p.character) : `<span class="muted">In menu</span>`}</td>
              <td>${p.department ? deptChip(p.department) : ""}</td>
              <td class="muted">${esc(p.ping)}ms</td>
              <td><div class="acts">
                <button class="btn btn-xs" data-act="player" data-op="goto" data-id="${esc(p.id)}">Goto</button>
                <button class="btn btn-xs" data-act="player" data-op="bring" data-id="${esc(p.id)}">Bring</button>
                <button class="btn btn-xs" data-act="player" data-op="spectate" data-id="${esc(p.id)}">Spectate</button>
                <button class="btn btn-xs good" data-act="player" data-op="revive" data-id="${esc(p.id)}">Revive</button>
                <button class="btn btn-xs" data-act="player" data-op="freeze" data-id="${esc(p.id)}">Freeze</button>
                <button class="btn btn-xs" data-act="dm" data-id="${esc(p.id)}">DM</button>
                <button class="btn btn-xs danger" data-act="kick" data-id="${esc(p.id)}">Kick</button>
                <button class="btn btn-xs danger" data-act="ban" data-id="${esc(p.id)}">Ban</button>
              </div></td>
            </tr>`).join("") || `<tr><td colspan="6" class="empty-state">Nobody is online.</td></tr>`}
        </tbody>
      </table>`,

    characters: () => `
      <h3>All Characters</h3>
      <div class="toolbar">
        <input data-search-input placeholder="Search by name, department or owner…">
        <button class="btn btn-create" data-act="charCreate">+ Create Character</button>
      </div>
      <table class="table">
        <thead><tr>
          <th>Name</th><th style="width:62px">Dept</th><th style="width:150px">Owner</th>
          <th style="width:96px">DOB</th><th style="width:196px">Actions</th>
        </tr></thead>
        <tbody>
          ${admin.characters.map((c) => `
            <tr data-search="${esc(`${fullName(c)} ${c.department} ${c.owner || ""}`.toLowerCase())}">
              <td>${marquee(fullName(c))}</td>
              <td>${deptChip(c.department)}</td>
              <td>${marquee(c.owner || "—")}</td>
              <td class="muted">${esc(c.dob || "")}</td>
              <td><div class="acts">
                <button class="btn btn-xs" data-act="charHistory" data-id="${esc(c.id)}">Crime History</button>
                <button class="btn btn-xs good" data-act="charEdit" data-id="${esc(c.id)}">Edit</button>
                <button class="btn btn-xs danger" data-act="charDelete" data-id="${esc(c.id)}">Delete</button>
              </div></td>
            </tr>`).join("") || `<tr><td colspan="5" class="empty-state">No characters yet.</td></tr>`}
        </tbody>
      </table>`,

    bans: () => `
      <h3>Bans</h3>
      <div class="toolbar">
        <input data-search-input placeholder="Search bans…">
        <span class="count-label">${admin.bans.length} active</span>
      </div>
      <table class="table">
        <thead><tr>
          <th style="width:120px">Player</th><th style="width:150px">Identifier</th><th>Reason</th>
          <th style="width:110px">Expires</th><th style="width:90px">By</th><th style="width:70px"></th>
        </tr></thead>
        <tbody>
          ${admin.bans.map((b) => `
            <tr data-search="${esc(`${b.name} ${b.identifier} ${b.reason} ${b.by}`.toLowerCase())}">
              <td>${marquee(b.name)}</td>
              <td class="muted">${marquee(b.identifier)}</td>
              <td>${marquee(b.reason)}</td>
              <td>${esc(b.expires)}</td>
              <td class="muted">${esc(b.by)}</td>
              <td><button class="btn btn-xs good" data-act="unban" data-id="${esc(b.id)}">Unban</button></td>
            </tr>`).join("") || `<tr><td colspan="6" class="empty-state">No active bans.</td></tr>`}
        </tbody>
      </table>`,

    world: () => `
      <h3>World</h3>
      <div class="card">
        <div class="section-title">Weather</div>
        <div class="chips">
          ${WEATHERS.map((w) => `<button class="chip ${w === admin.weather ? "active" : ""}" data-act="weather" data-value="${w}">${w}</button>`).join("")}
        </div>
      </div>

      <div class="card section">
        <div class="spaced">
          <div class="section-title" style="margin:0">Time of Day</div>
          <b id="adm-time-label">${hour(admin.time)}</b>
        </div>
        <div class="inline" style="margin-top:10px">
          <input type="range" id="adm-time" min="0" max="23" value="${Number(admin.time) || 0}">
          <button class="btn btn-primary" data-act="setTime">Set Time</button>
        </div>
      </div>

      <div class="grid-2 section">
        <div class="card spaced">
          <div><b>Freeze Time</b><div class="hint">Stop the in-game clock</div></div>
          <button class="switch ${admin.freezeTime ? "on" : ""}" data-act="freezeTime"></button>
        </div>
        <div class="card spaced">
          <div><b>Blackout</b><div class="hint">Turn off all city lights</div></div>
          <button class="switch ${admin.blackout ? "on" : ""}" data-act="blackout"></button>
        </div>
      </div>

      <div class="card section spaced">
        <div><b>Clear Unoccupied Vehicles</b><div class="hint">Deletes every empty vehicle on the map</div></div>
        <button class="btn btn-delete" data-act="clearVehicles">Clear Vehicles</button>
      </div>`,

    logs: () => `
      <h3>Admin Logs</h3>
      ${admin.logs.map((l) => `
        <div class="log"><time>${esc(l.time)}</time><span class="who">${esc(l.admin)}</span><span>${esc(l.action)}</span></div>`).join("")
        || `<div class="empty-state">Nothing logged yet.</div>`}`,
  };

  // Runs the action in Lua; on success logs it, toasts, and re-renders the tab.
  async function act(action, payload, message) {
    const res = await post("adminAction", { action, ...payload });
    if (res.ok === false) {
      toast(res.error || "Action failed", "error");
      return false;
    }
    admin.logs.unshift({ time: clock(), admin: "You", action: message });
    toast(message);
    show(tab);
    return true;
  }

  async function onAction(action, btn) {
    const id = btn.dataset.id;
    const player = admin.players.find((p) => String(p.id) === id);
    const character = admin.characters.find((c) => String(c.id) === id);

    switch (action) {
      case "tab":
        return show(btn.dataset.tab);

      case "refresh":
        Object.assign(admin, await post("adminGetData"));
        return show(tab);

      // ---- dashboard ----
      case "aopPreset":
        $("#adm-aop", m).value = btn.dataset.value;
        return;
      case "setAop": {
        const aop = $("#adm-aop", m).value.trim();
        if (!aop) return flash($("#adm-aop", m));
        state.aop = aop;
        renderStatus();
        return act("setAop", { aop }, `Set AOP to ${aop}`);
      }
      case "priority":
        state.priority = btn.dataset.value;
        renderStatus();
        return act("setPriority", { priority: state.priority }, `Set priority to ${state.priority}`);
      case "peacetime":
        state.peacetime = !state.peacetime;
        renderStatus();
        return act("setPeacetime", { enabled: state.peacetime }, `Turned peacetime ${state.peacetime ? "on" : "off"}`);
      case "announce": {
        const box = $("#adm-announce", m);
        const message = box.value.trim();
        if (!message) return flash(box);
        return act("announce", { message }, `Announcement: "${message}"`);
      }

      // ---- players ----
      case "player": {
        const labels = { goto: "Teleported to", bring: "Brought", spectate: "Spectating", revive: "Revived", freeze: "Toggled freeze on" };
        return act(btn.dataset.op, { target: player.id }, `${labels[btn.dataset.op]} ${player.name}`);
      }
      case "dm": {
        const v = await confirmModal({
          title: `Message ${player.name}`,
          text: "Send a private admin message to this player.",
          confirmLabel: "Send",
          fields: `<textarea name="message" required maxlength="250" placeholder="Message…"></textarea>`,
        });
        if (v) act("dm", { target: player.id, message: v.message }, `Messaged ${player.name}`);
        return;
      }
      case "kick": {
        const v = await confirmModal({
          title: `Kick ${player.name}?`,
          text: "They will be removed from the server and can rejoin.",
          confirmLabel: "Kick",
          danger: true,
          fields: `<label>Reason<input name="reason" required maxlength="120" placeholder="e.g. Failure to RP"></label>`,
        });
        if (!v) return;
        admin.players = admin.players.filter((p) => p !== player);
        act("kick", { target: player.id, reason: v.reason }, `Kicked ${player.name} (${v.reason})`);
        return;
      }
      case "ban": {
        const v = await confirmModal({
          title: `Ban ${player.name}?`,
          text: "They will be removed and blocked from rejoining.",
          confirmLabel: "Ban",
          danger: true,
          fields: `
            <label>Reason<input name="reason" required maxlength="120" placeholder="e.g. RDM / VDM"></label>
            <label>Duration
              <select name="duration">
                <option value="1h">1 hour</option><option value="1d">1 day</option><option value="3d">3 days</option>
                <option value="7d" selected>7 days</option><option value="30d">30 days</option><option value="perm">Permanent</option>
              </select>
            </label>`,
        });
        if (!v) return;
        const expires = { "1h": "1 hour", "1d": "1 day", "3d": "3 days", "7d": "7 days", "30d": "30 days", perm: "Permanent" }[v.duration];
        admin.players = admin.players.filter((p) => p !== player);
        admin.bans.unshift({ id: Date.now(), name: player.name, identifier: player.identifier || `id:${player.id}`, reason: v.reason, expires, by: "You" });
        act("ban", { target: player.id, reason: v.reason, duration: v.duration }, `Banned ${player.name} for ${expires} (${v.reason})`);
        return;
      }
      case "unban": {
        const ban = admin.bans.find((b) => String(b.id) === id);
        if (!(await confirmModal({ title: `Unban ${ban.name}?`, text: "They will be able to join again.", confirmLabel: "Unban" }))) return;
        admin.bans = admin.bans.filter((b) => b !== ban);
        act("unban", { banId: ban.id }, `Unbanned ${ban.name}`);
        return;
      }

      // ---- characters ----
      case "charCreate":
        return openCharacterModal(null, {
          admin: true,
          onSaved: (c) => {
            admin.characters.push(c);
            admin.logs.unshift({ time: clock(), admin: "You", action: `Created character ${fullName(c)} for ${c.owner}` });
            show("characters");
          },
        });
      case "charEdit":
        return openCharacterModal(character, {
          admin: true,
          onSaved: (c) => {
            admin.logs.unshift({ time: clock(), admin: "You", action: `Edited character ${fullName(c)}` });
            show("characters");
          },
        });
      case "charHistory":
        return openCrimeHistory(character, { admin: true });
      case "charDelete": {
        const ok = await confirmModal({
          title: "Delete character?",
          text: `${fullName(character)} (owned by ${character.owner || "unknown"}) will be permanently deleted.`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (!ok) return;
        admin.characters = admin.characters.filter((c) => c !== character);
        state.characters = state.characters.filter((c) => c.id !== character.id);
        renderList();
        act("deleteCharacter", { id: character.id }, `Deleted character ${fullName(character)}`);
        return;
      }

      // ---- world ----
      case "weather":
        admin.weather = btn.dataset.value;
        return act("setWeather", { weather: admin.weather }, `Set weather to ${admin.weather}`);
      case "setTime":
        admin.time = Number($("#adm-time", m).value);
        return act("setTime", { hour: admin.time }, `Set time to ${hour(admin.time)}`);
      case "freezeTime":
        admin.freezeTime = !admin.freezeTime;
        return act("freezeTime", { enabled: admin.freezeTime }, `${admin.freezeTime ? "Froze" : "Unfroze"} time`);
      case "blackout":
        admin.blackout = !admin.blackout;
        return act("blackout", { enabled: admin.blackout }, `Turned blackout ${admin.blackout ? "on" : "off"}`);
      case "clearVehicles":
        if (await confirmModal({ title: "Clear vehicles?", text: "Every unoccupied vehicle on the map will be deleted.", confirmLabel: "Clear", danger: true })) {
          act("clearVehicles", {}, "Cleared unoccupied vehicles");
        }
        return;
    }
  }

  show(tab);
}

/* ================= helpers ================= */

function marquee(text, cls = "") {
  return `<span class="marquee"><span class="marquee-inner ${cls}">${esc(text)}</span></span>`;
}

// Text that overflows its box slides back and forth instead of being cut off.
function applyMarquee(root) {
  requestAnimationFrame(() => {
    $$(".marquee", root).forEach((box) => {
      const inner = box.firstElementChild;
      box.classList.remove("scroll");
      const dist = inner.scrollWidth - box.clientWidth;
      if (dist > 1) {
        box.classList.add("scroll");
        box.style.setProperty("--dist", `${dist + 6}px`);
        box.style.setProperty("--dur", `${Math.max(2.5, dist / 20 + 1.5).toFixed(1)}s`);
      }
    });
  });
}

function deptChip(d) {
  return `<span class="dept" style="--c:${DEPT_COLORS[d] || "#6b7280"}">${esc(d || "—")}</span>`;
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="tile-label">${esc(label)}</div><div class="tile-value">${esc(value)}</div>${sub ? `<div class="tile-sub">${esc(sub)}</div>` : ""}</div>`;
}

function toast(message, type = "ok") {
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : ""}`;
  el.textContent = message;
  $("#toasts").appendChild(el);
  setTimeout(() => el.classList.add("out"), 2600);
  setTimeout(() => el.remove(), 2900);
}

function flash(el) {
  if (el.focus) el.focus();
  el.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
    { duration: 250 }
  );
}

const fullName = (c) => `${c.firstName} ${c.lastName}`;
const initials = (c) => `${(c.firstName || "?")[0]}${(c.lastName || "")[0] || ""}`.toUpperCase();
const sum = (list, key) => list.reduce((n, r) => n + (Number(r[key]) || 0), 0);
const money = (n) => `$${Number(n).toLocaleString("en-US")}`;
const hour = (h) => `${String(h).padStart(2, "0")}:00`;
const clock = () => new Date().toTimeString().slice(0, 5);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ================= browser preview (ignored in game) ================= */

const MOCK_RECORDS = {
  2: {
    licenses: [
      { name: "Driver", status: "Suspended" }, { name: "Firearm", status: "Revoked" },
      { name: "Hunting", status: "None" }, { name: "Pilot", status: "None" },
    ],
    records: [
      { id: "W-219",   type: "Warrant",  date: "2026-10-06", charges: ["Failure to Appear", "Grand Theft Auto"], officer: "John Finger", agency: "BCSO", fine: 0, jail: 0, status: "Active" },
      { id: "C-10421", type: "Citation", date: "2026-10-02", charges: ["Speeding (25+ over)", "Reckless Driving"], officer: "Nathan Valentino", agency: "SAHP", fine: 1250, jail: 0, status: "Unpaid" },
      { id: "A-3381",  type: "Arrest",   date: "2026-09-28", charges: ["Armed Robbery", "Evading a Peace Officer", "Possession of a Stolen Firearm"], officer: "Mike Foxtrot", agency: "LSPD", fine: 7500, jail: 45, status: "Served" },
      { id: "C-10002", type: "Citation", date: "2026-09-14", charges: ["Running a Red Light"], officer: "Jake Vic", agency: "SAHP", fine: 250, jail: 0, status: "Paid" },
      { id: "A-3102",  type: "Arrest",   date: "2026-08-30", charges: ["Public Intoxication", "Resisting Arrest"], officer: "Mike Foxtrot", agency: "LSPD", fine: 1000, jail: 10, status: "Served" },
      { id: "WN-77",   type: "Warning",  date: "2026-08-11", charges: ["Broken Tail Light"], officer: "John Finger", agency: "BCSO", fine: 0, jail: 0, status: "Issued" },
    ],
  },
  4: {
    licenses: [{ name: "Driver", status: "Valid" }, { name: "Firearm", status: "Valid" }],
    records: [
      { id: "C-9001", type: "Citation", date: "2026-07-03", charges: ["Illegal Parking"], officer: "Jake Vic", agency: "SAHP", fine: 150, jail: 0, status: "Paid" },
    ],
  },
};

const MOCK_ADMIN = {
  uptime: "6h 14m",
  weather: "EXTRASUNNY",
  time: 14,
  freezeTime: false,
  blackout: false,
  players: [
    { id: 1,  name: "natan",       identifier: "license:8c1f…", character: "Nathan Valentino", department: "SAHP", ping: 42 },
    { id: 3,  name: "Kraken",      identifier: "license:2ab9…", character: "Mike Foxtrot", department: "LSPD", ping: 55 },
    { id: 7,  name: "xXGhostXx",   identifier: "license:77d0…", character: "Chicken Fingers", department: "CIV", ping: 88 },
    { id: 9,  name: "Bubba",       identifier: "license:91ee…", character: "Hank Hill", department: "CIV", ping: 71 },
    { id: 12, name: "MedicMike",   identifier: "license:c4a2…", character: "Bartholomew Montgomery-Wellington III", department: "SAFR", ping: 34 },
    { id: 15, name: "Deputy_Dan",  identifier: "license:5d3b…", character: "John Finger", department: "BCSO", ping: 60 },
    { id: 18, name: "TheRealSlimShadyFromLosSantos", identifier: "license:0fa1…", character: "Marshall Mathers", department: "CIV", ping: 97 },
    { id: 21, name: "SpeedyG",     identifier: "license:e19c…", character: null, department: null, ping: 120 },
  ],
  characters: [
    { id: 1,  firstName: "Jake",        lastName: "Vic",        dob: "1990-04-12", gender: "Male",   department: "SAHP", owner: "natan" },
    { id: 2,  firstName: "Chicken",     lastName: "Fingers",    dob: "1995-08-01", gender: "Male",   department: "CIV",  owner: "natan" },
    { id: 3,  firstName: "Nathan",      lastName: "Valentino",  dob: "1988-02-20", gender: "Male",   department: "SAHP", owner: "natan" },
    { id: 4,  firstName: "Mike",        lastName: "Foxtrot",    dob: "1992-11-30", gender: "Male",   department: "LSPD", owner: "natan" },
    { id: 5,  firstName: "John",        lastName: "Finger",     dob: "1985-06-15", gender: "Male",   department: "BCSO", owner: "natan" },
    { id: 6,  firstName: "Bartholomew", lastName: "Montgomery-Wellington III", dob: "1979-01-09", gender: "Male", department: "SAFR", owner: "MedicMike" },
    { id: 7,  firstName: "Hank",        lastName: "Hill",       dob: "1970-03-02", gender: "Male",   department: "CIV",  owner: "Bubba" },
    { id: 8,  firstName: "Sarah",       lastName: "Connor",     dob: "1984-05-13", gender: "Female", department: "LSPD", owner: "Kraken" },
  ],
  bans: [
    { id: 1, name: "ToxicTim",  identifier: "license:3f9a…", reason: "RDM / VDM in Legion Square", expires: "Permanent", by: "natan" },
    { id: 2, name: "ModMenuMo", identifier: "license:aa01…", reason: "Using a mod menu to spawn vehicles", expires: "Permanent", by: "Kraken" },
    { id: 3, name: "FailRPFred", identifier: "license:71bc…", reason: "Failure to value life", expires: "3 days", by: "natan" },
  ],
  logs: [
    { time: "14:02", admin: "natan",  action: "Kicked AFKAndy (AFK in a pursuit)" },
    { time: "13:47", admin: "Kraken", action: "Set AOP to Los Santos" },
    { time: "13:30", admin: "natan",  action: "Set priority to Cooldown" },
    { time: "12:58", admin: "Kraken", action: "Banned ModMenuMo for Permanent (Using a mod menu)" },
  ],
};

function mockResponse(event, data) {
  switch (event) {
    case "createCharacter":
    case "playCharacter":
      // Pretend to spawn, then reopen so the preview keeps working.
      setTimeout(() => window.postMessage({ action: "open", characters: state.characters }, "*"), 1200);
      return event === "createCharacter" ? { id: Date.now() } : {};
    case "getCrimeHistory":
      return JSON.parse(JSON.stringify(MOCK_RECORDS[data.id] || { licenses: [{ name: "Driver", status: "Valid" }], records: [] }));
    case "adminGetData":
      return MOCK_ADMIN;
    case "disconnect":
      toast("(preview) Disconnect sent");
      return {};
    default:
      return {};
  }
}

if (isBrowser) {
  document.body.classList.add("preview");
  window.postMessage({
    action: "open",
    isAdmin: true,
    aop: "Los Santos",
    priority: "Available",
    peacetime: false,
    online: 37,
    maxPlayers: 64,
    characters: MOCK_ADMIN.characters.slice(0, 6).map(({ owner, ...c }) => c),
  }, "*");
}
