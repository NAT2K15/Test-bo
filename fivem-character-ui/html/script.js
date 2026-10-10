/*
 * SSDOJ character select NUI.
 *
 * Lua -> NUI (SendNUIMessage):
 *   { action: "open",  characters: [...], departments: [...]?, spawns: {...}? }
 *   { action: "setCharacters", characters: [...] }
 *   { action: "close" }
 *
 * NUI -> Lua (RegisterNUICallback):
 *   createCharacter { character, spawn }   -> respond with { id } (optional)
 *   editCharacter   { character }
 *   deleteCharacter { id }
 *   previewSpawn    { spawn }              -- fired on hover/select, move the cam here
 *   playCharacter   { id, spawn }
 *
 * Character shape: { id, firstName, lastName, dob, gender, department }
 */

const isBrowser = typeof GetParentResourceName !== "function";
const resource = isBrowser ? "ssdoj-characters" : GetParentResourceName();

let departments = ["CIV", "LSPD", "BCSO", "SAHP", "SAFR", "DOT"];

// Spawns per department. "ALL" is appended to every list.
let spawns = {
  ALL:  [{ id: "last", name: "Last Location", area: "Where you logged off", icon: "📍" }],
  CIV:  [
    { id: "legion",   name: "Legion Square",       area: "Los Santos",    icon: "🏙️" },
    { id: "airport",  name: "LS International",    area: "Los Santos",    icon: "✈️" },
    { id: "sandy",    name: "Sandy Shores",        area: "Blaine County", icon: "🏜️" },
    { id: "paleto",   name: "Paleto Bay",          area: "Blaine County", icon: "🌲" },
  ],
  LSPD: [
    { id: "missionrow", name: "Mission Row PD",    area: "Los Santos",    icon: "🚓" },
    { id: "vespucci",   name: "Vespucci PD",       area: "Los Santos",    icon: "🚓" },
    { id: "vinewood",   name: "Vinewood PD",       area: "Los Santos",    icon: "🚓" },
  ],
  BCSO: [
    { id: "sandyso",  name: "Sandy Shores SO",     area: "Blaine County", icon: "⭐" },
    { id: "paletoso", name: "Paleto Bay SO",       area: "Blaine County", icon: "⭐" },
  ],
  SAHP: [
    { id: "sahphq",   name: "SAHP Headquarters",   area: "Los Santos",    icon: "🏍️" },
    { id: "route68",  name: "Route 68 Station",    area: "Harmony",       icon: "🏍️" },
  ],
  SAFR: [
    { id: "fs7",      name: "Fire Station 7",      area: "Los Santos",    icon: "🚒" },
    { id: "pillbox",  name: "Pillbox Medical",     area: "Los Santos",    icon: "🚑" },
    { id: "sandyfd",  name: "Sandy Shores FD",     area: "Blaine County", icon: "🚒" },
  ],
  DOT:  [
    { id: "dotyard",  name: "DOT Yard",            area: "La Mesa",       icon: "🚧" },
  ],
};

let characters = [];
let editingId = null;
let playingId = null;
let pendingDeleteId = null;
let formSpawn = null;
let playSpawn = null;

const $ = (sel) => document.querySelector(sel);
const app = $("#app");

/* ---------------- NUI bridge ---------------- */

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
    return await res.json().catch(() => ({}));
  } catch {
    return {};
  }
}

window.addEventListener("message", ({ data }) => {
  switch (data.action) {
    case "open":
      if (data.departments) departments = data.departments;
      if (data.spawns) spawns = data.spawns;
      characters = data.characters || [];
      open();
      break;
    case "setCharacters":
      characters = data.characters || [];
      renderList();
      break;
    case "close":
      close();
      break;
  }
});

function open() {
  app.classList.remove("hidden");
  fillDepartments();
  showView("list");
}

function close() {
  app.classList.add("hidden");
  $("#modal").classList.add("hidden");
}

/* ---------------- views ---------------- */

function showView(name) {
  for (const v of ["list", "form", "spawn"]) {
    $(`#view-${v}`).classList.toggle("hidden", v !== name);
  }
  if (name === "list") renderList();
}

function renderList() {
  const list = $("#char-list");
  list.innerHTML = "";
  if (!characters.length) {
    list.innerHTML = `<p class="empty">You have no characters yet.</p>`;
    return;
  }
  characters.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "char-row";
    row.style.animationDelay = `${i * 40}ms`;
    row.innerHTML = `
      <button class="btn btn-play">Play As: ${esc(c.firstName)} ${esc(c.lastName)} (${esc(c.department)})</button>
      <button class="btn btn-edit">Edit</button>
      <button class="btn btn-delete">Delete</button>`;
    const [play, edit, del] = row.querySelectorAll("button");
    play.onclick = () => openSpawnSelect(c);
    edit.onclick = () => openForm(c);
    del.onclick = () => askDelete(c);
    list.appendChild(row);
  });
}

function fillDepartments() {
  $("#dept-select").innerHTML = departments
    .map((d) => `<option value="${esc(d)}">${esc(d)}</option>`)
    .join("");
}

function spawnsFor(dept) {
  return [...(spawns[dept] || spawns.CIV || []), ...(spawns.ALL || [])];
}

function renderSpawns(container, list, selectedId, onSelect) {
  container.innerHTML = "";
  list.forEach((s) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "spawn" + (s.id === selectedId ? " selected" : "");
    el.innerHTML = `
      <span class="spawn-icon">${s.icon || "📍"}</span>
      <span><div class="spawn-name">${esc(s.name)}</div><div class="spawn-area">${esc(s.area || "")}</div></span>`;
    el.onmouseenter = () => post("previewSpawn", { spawn: s });
    el.onclick = () => {
      container.querySelectorAll(".spawn").forEach((x) => x.classList.remove("selected"));
      el.classList.add("selected");
      onSelect(s);
    };
    container.appendChild(el);
  });
}

/* ---------------- create / edit ---------------- */

function openForm(character = null) {
  const form = $("#char-form");
  form.reset();
  editingId = character ? character.id : null;
  formSpawn = null;

  $("#form-title").textContent = character ? "Edit character" : "Create a character";
  $("#form-submit").textContent = character ? "Save Changes" : "Create & Spawn";
  // Spawn only matters when creating; existing characters pick it on Play.
  $("#form-spawn-wrap").classList.toggle("hidden", !!character);

  if (character) {
    for (const key of ["firstName", "lastName", "dob", "gender", "department"]) {
      if (form.elements[key]) form.elements[key].value = character[key] ?? "";
    }
  }
  refreshFormSpawns();
  showView("form");
  form.elements.firstName.focus();
}

function refreshFormSpawns() {
  const dept = $("#dept-select").value;
  formSpawn = null;
  renderSpawns($("#form-spawns"), spawnsFor(dept), null, (s) => (formSpawn = s));
}

$("#dept-select").addEventListener("change", refreshFormSpawns);

$("#char-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const character = Object.fromEntries(fd.entries());
  character.firstName = character.firstName.trim();
  character.lastName = character.lastName.trim();

  if (editingId !== null) {
    character.id = editingId;
    await post("editCharacter", { character });
    const idx = characters.findIndex((c) => c.id === editingId);
    if (idx > -1) characters[idx] = { ...characters[idx], ...character };
    showView("list");
    return;
  }

  if (!formSpawn) {
    flash($("#form-spawns"));
    return;
  }
  const res = await post("createCharacter", { character, spawn: formSpawn });
  character.id = res && res.id != null ? res.id : Date.now();
  characters.push(character);
  close();
});

/* ---------------- play / spawn ---------------- */

function openSpawnSelect(character) {
  playingId = character.id;
  playSpawn = null;
  $("#btn-spawn").disabled = true;
  $("#spawn-who").textContent = `${character.firstName} ${character.lastName} · ${character.department}`;
  renderSpawns($("#spawn-list"), spawnsFor(character.department), null, (s) => {
    playSpawn = s;
    $("#btn-spawn").disabled = false;
  });
  showView("spawn");
}

$("#btn-spawn").onclick = async () => {
  if (!playSpawn) return;
  await post("playCharacter", { id: playingId, spawn: playSpawn });
  close();
};

/* ---------------- delete ---------------- */

function askDelete(character) {
  pendingDeleteId = character.id;
  $("#modal-text").textContent =
    `${character.firstName} ${character.lastName} (${character.department}) will be permanently deleted.`;
  $("#modal").classList.remove("hidden");
}

$("#modal-cancel").onclick = () => $("#modal").classList.add("hidden");
$("#modal-confirm").onclick = async () => {
  await post("deleteCharacter", { id: pendingDeleteId });
  characters = characters.filter((c) => c.id !== pendingDeleteId);
  $("#modal").classList.add("hidden");
  renderList();
};

/* ---------------- misc ---------------- */

$("#btn-create").onclick = () => openForm();
document.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => showView("list")));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#modal").classList.contains("hidden")) $("#modal").classList.add("hidden");
  else if ($("#view-list").classList.contains("hidden")) showView("list");
});

function flash(el) {
  el.animate(
    [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
    { duration: 250 }
  );
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/* ---------------- browser preview ---------------- */

// Pretend to spawn, then reopen the menu so the preview keeps working.
function mockResponse(event) {
  if (event === "playCharacter" || event === "createCharacter") {
    setTimeout(() => window.postMessage({ action: "open", characters }, "*"), 1200);
  }
  return event === "createCharacter" ? { id: Date.now() } : {};
}

if (isBrowser) {
  document.body.classList.add("preview");
  window.postMessage({
    action: "open",
    characters: [
      { id: 1, firstName: "Jake",     lastName: "Vic",       dob: "1990-04-12", gender: "Male", department: "SAHP" },
      { id: 2, firstName: "Chicken",  lastName: "Fingers",   dob: "1995-08-01", gender: "Male", department: "CIV"  },
      { id: 3, firstName: "Nathan",   lastName: "Valentino", dob: "1988-02-20", gender: "Male", department: "SAHP" },
      { id: 4, firstName: "Mike",     lastName: "Foxtrot",   dob: "1992-11-30", gender: "Male", department: "LSPD" },
      { id: 5, firstName: "John",     lastName: "Finger",    dob: "1985-06-15", gender: "Male", department: "BCSO" },
    ],
  }, "*");
}
