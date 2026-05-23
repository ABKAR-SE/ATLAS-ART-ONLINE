/* =============================================
   AAO — Atlas Art Online | script.js
   Atlas Valley × Sword Art Online
   Full game engine: world, battle, UI, Supabase
   ============================================= */

// ============================================================
// CONFIG — Supabase (dev/testing)
// ============================================================
const SUPABASE_URL = "https://sb_publishable_4vMEgngHRb_kBypf5575lA_M-6rdI2F.supabase.co";
const SUPABASE_KEY = "sb_publishable_4vMEgngHRb_kBypf5575lA_M-6rdI2F";

// API base (se usi atlasartonline.py locale)
const API_BASE = window.location.hostname === "localhost"
  ? "http://localhost:8000/api"
  : "/api";

// ============================================================
// GAME STATE
// ============================================================
let G = {
  playerId: null,
  save: null,
  creatures: {},
  world: {},
  moves: {},
  items: {},
  // Battle session (client-side)
  battle: null,
  // Dialog state
  dialog: { lines: [], index: 0, npc: null, onEnd: null },
  // Canvas / world
  canvas: null,
  ctx: null,
  tileSize: 32,
  camera: { x: 0, y: 0 },
  mapData: null,
  moving: false,
  moveQueue: [],
  // Schema cache
  sqlSchema: ""
};

// ============================================================
// INIT
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  generateStars();
  await loadGameData();
  renderCodex();
  renderWorldMap();
  loadSQLSchema();
  showScreen("screen-intro");
  setupKeyboard();
});

// ============================================================
// LOAD GAME DATA (from addons/ JSON files)
// ============================================================
async function loadGameData() {
  try {
    const [creatures, world, movesArr, items] = await Promise.all([
      fetchJSON("addons/creatures.json"),
      fetchJSON("addons/world.json"),
      fetchJSON("addons/moves.json"),
      fetchJSON("addons/items.json")
    ]);
    G.creatures = creatures;
    G.world = world;
    G.moves = {};
    movesArr.forEach(m => G.moves[m.name] = m);
    G.items = items;
  } catch (e) {
    console.error("Failed to load game data:", e);
  }
}

async function fetchJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed to fetch ${path}`);
  return r.json();
}

// ============================================================
// SCREEN MANAGER
// ============================================================
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) {
    target.classList.add("active");
    target.scrollTop = 0;
  }

  // Screen-specific init
  if (id === "screen-game") initGameCanvas();
  if (id === "screen-team") renderTeam();
  if (id === "screen-bag")  renderBag();
  if (id === "screen-menu") renderMenuInfo();
  if (id === "screen-codex") renderCodex();
}

// ============================================================
// STARS BACKGROUND
// ============================================================
function generateStars() {
  const container = document.getElementById("stars");
  if (!container) return;
  for (let i = 0; i < 80; i++) {
    const s = document.createElement("div");
    s.className = "star";
    s.style.left = Math.random() * 100 + "%";
    s.style.top  = Math.random() * 100 + "%";
    const dur = (2 + Math.random() * 4).toFixed(1) + "s";
    s.style.setProperty("--dur", dur);
    s.style.animationDelay = (Math.random() * 4).toFixed(1) + "s";
    container.appendChild(s);
  }
}

// ============================================================
// NEW GAME
// ============================================================
function selectChar(el) {
  document.querySelectorAll(".char-card").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
}

function selectStarter(el) {
  document.querySelectorAll(".starter-card").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
}

async function startNewGame() {
  const name = document.getElementById("ng-name").value.trim();
  const charEl = document.querySelector(".char-card.active");
  const starterEl = document.querySelector(".starter-card.active");

  if (!name) return showFormStatus("ng-status", "error", "Inserisci il tuo nome!");
  if (!charEl || !starterEl) return showFormStatus("ng-status", "error", "Scegli personaggio e starter.");

  const character = charEl.dataset.char;
  const starter   = starterEl.dataset.starter;

  showFormStatus("ng-status", "success", "⚡ Inizializzazione partita...");

  // Build save locally (works without backend)
  const save = buildNewSave(name, character, starter);
  G.save = save;
  G.playerId = save.player.id;

  // Try Supabase save
  await supabaseSave(save);

  // Persist locally
  localStorage.setItem("aao_save", JSON.stringify(save));
  localStorage.setItem("aao_player_id", G.playerId);

  // Boot game
  showScreen("screen-game");
  setTimeout(() => startIntroSequence(), 300);
}

function buildNewSave(name, character, starterKey) {
  const id = "player_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  const starterAeon = buildAeon(starterKey, 5);

  return {
    player: { id, name, character, credits: 3000, badges: [], steps: 0, battles_won: 0, battles_lost: 0 },
    location: { map: "atlas-hub", x: 7, y: 7 },
    team: [starterAeon],
    box: [],
    codex: { [starterKey]: { seen: true, caught: true } },
    inventory: { "NanoCell": 5, "AEONball": 5 },
    flags: {
      received_starter: true, met_panthera: false, met_elf: false,
      atlas_hub_gym_cleared: false, nova_city_gym_cleared: false,
      deep_server_gym_cleared: false, council_cleared: false, barber_boss_beaten: false
    },
    settings: { text_speed: "normal", sound: true, mobile_controls: true },
    created_at: new Date().toISOString()
  };
}

// ============================================================
// LOAD GAME
// ============================================================
async function loadGame() {
  const pid = document.getElementById("lg-playerid").value.trim();
  if (!pid) return showFormStatus("lg-status", "error", "Inserisci il Player ID.");
  showFormStatus("lg-status", "success", "🔄 Caricamento...");

  try {
    const result = await supabaseLoad(pid);
    if (result) {
      G.save = result;
      G.playerId = pid;
      localStorage.setItem("aao_save", JSON.stringify(result));
      localStorage.setItem("aao_player_id", pid);
      showScreen("screen-game");
    } else {
      showFormStatus("lg-status", "error", "Salvataggio non trovato.");
    }
  } catch (e) {
    showFormStatus("lg-status", "error", "Errore di connessione. Prova dal dispositivo.");
  }
}

function loadFromLocalStorage() {
  const raw = localStorage.getItem("aao_save");
  const pid = localStorage.getItem("aao_player_id");
  if (!raw) return showFormStatus("lg-status", "error", "Nessun salvataggio trovato sul dispositivo.");
  G.save = JSON.parse(raw);
  G.playerId = pid;
  showScreen("screen-game");
}

// ============================================================
// SUPABASE HELPERS
// ============================================================
async function supabaseSave(save) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/players`, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        id: save.player.id,
        name: save.player.name,
        character: save.player.character,
        save_data: save,
        battles_won: save.player.battles_won || 0,
        badges_count: (save.player.badges || []).length,
        created_at: save.created_at
      })
    });
    if (!res.ok) {
      // Try PATCH if already exists
      await fetch(`${SUPABASE_URL}/rest/v1/players?id=eq.${save.player.id}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ save_data: save, battles_won: save.player.battles_won || 0 })
      });
    }
  } catch (e) {
    console.warn("Supabase save failed (offline?):", e);
  }
}

async function supabaseLoad(playerId) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/players?id=eq.${playerId}&select=*`, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      }
    });
    const data = await res.json();
    if (data && data[0]) return data[0].save_data;
    return null;
  } catch (e) {
    return null;
  }
}

async function saveGame() {
  if (!G.save) return;
  localStorage.setItem("aao_save", JSON.stringify(G.save));
  await supabaseSave(G.save);
  showToast("💾 Partita salvata!");
}

// ============================================================
// AEON BUILDER (client-side)
// ============================================================
function buildAeon(creatureKey, level) {
  const base = G.creatures[creatureKey.toUpperCase()];
  if (!base) return null;

  const calcStat = (b, lv, isHp = false) =>
    isHp ? Math.floor((2 * b * lv) / 100) + lv + 10
         : Math.floor((2 * b * lv) / 100) + 5;

  const hp = calcStat(base.hp, level, true);
  const stats = {
    hp,
    atk: calcStat(base.atk, level),
    def: calcStat(base.def, level),
    spa: calcStat(base.spa, level),
    spd: calcStat(base.spd, level),
    spe: calcStat(base.spe, level)
  };

  const learnable = (base.moves || []).filter(m => m.level <= level).map(m => m.name);
  const moves = learnable.slice(-4).length ? learnable.slice(-4) : ["tackle"];

  return {
    id: `${creatureKey}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
    creature_id: creatureKey.toUpperCase(),
    name: base.name,
    type: base.type,
    level,
    xp: 0,
    xp_next: Math.pow(level, 3),
    current_hp: hp,
    stats,
    moves,
    status: null,
    catch_rate: base.catch || 45,
    sprite: base.sprite || "?",
    color: base.color || "#ffffff",
    legendary: base.legendary || false
  };
}

// ============================================================
// CANVAS WORLD ENGINE
// ============================================================
function initGameCanvas() {
  if (!G.save) return;

  G.canvas = document.getElementById("game-canvas");
  G.ctx = G.canvas.getContext("2d");

  const vp = document.getElementById("world-viewport");
  G.canvas.width  = vp.clientWidth;
  G.canvas.height = vp.clientHeight;

  G.mapData = G.world[G.save.location.map] || G.world["atlas-hub"];
  updateHUDLocation();
  updateQuickTeam();
  renderWorld();
}

function renderWorld() {
  if (!G.ctx || !G.canvas) return;
  const ctx = G.ctx;
  const W = G.canvas.width, H = G.canvas.height;
  const ts = G.tileSize;

  ctx.clearRect(0, 0, W, H);

  // Background gradient based on map type
  const terrain = G.mapData?.tiles?.terrain || "urban_future";
  const gradients = {
    urban_future: ["#0a1020", "#12203a"],
    field:        ["#0a1a0a", "#102a10"],
    highway:      ["#101010", "#1a1a2a"],
    ridge:        ["#0a0a1a", "#10102a"],
    coastal:      ["#0a1828", "#102040"],
    urban_stylish:["#120a1a", "#1a102a"],
    industrial:   ["#1a1010", "#2a1010"],
    elite:        ["#1a1000", "#2a2000"]
  };
  const [c1, c2] = gradients[terrain] || gradients.urban_future;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = "rgba(201,168,76,0.04)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += ts) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += ts) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // Draw terrain features
  drawFeatures(ctx, W, H, ts);

  // Draw NPCs
  if (G.mapData?.npcs) {
    G.mapData.npcs.forEach(npc => {
      const pos = npc.position || { x: 5, y: 5 };
      const nx = pos.x * ts - G.camera.x + W / 2;
      const ny = pos.y * ts - G.camera.y + H / 2;
      if (nx > -ts && nx < W + ts && ny > -ts && ny < H + ts) {
        ctx.font = `${ts * 0.7}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(npc.sprite || "👤", nx + ts/2, ny + ts/2);
        // Name tag
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(nx - 20, ny - 18, 40, 12);
        ctx.fillStyle = "#c9a84c";
        ctx.font = `8px 'Share Tech Mono'`;
        ctx.fillText(npc.name.slice(0, 10), nx + ts/2, ny - 12);
      }
    });
  }

  // Draw player
  const px = W / 2;
  const py = H / 2;

  // Player shadow
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(px + ts/2, py + ts - 4, ts/2 - 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Player sprite
  const charSprite = G.save?.player?.character === "elf_wizard" ? "🧝" : "🐾";
  ctx.font = `${ts * 0.8}px serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(charSprite, px + ts/2, py + ts/2);

  // Player highlight ring
  ctx.strokeStyle = "rgba(201,168,76,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px + ts/2, py + ts/2, ts/2 + 2, 0, Math.PI * 2);
  ctx.stroke();

  // Map name overlay
  ctx.fillStyle = "rgba(201,168,76,0.6)";
  ctx.font = "10px 'Share Tech Mono'";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(G.mapData?.name || "Atlas Hub", 10, 10);

  // Feature labels
  const features = G.mapData?.tiles?.features || [];
  features.forEach((f, i) => {
    const icons = {
      solar_panels: "☀️", wind_turbines: "🌀", drones: "🚁",
      electric_scooters: "🛴", ev_charging: "🔌", wave_energy: "🌊",
      hydrogen_plant: "⚗️", atlas_barber_salon: "✂️", barber_bots: "🤖",
      smart_lights: "💡", monopattini: "🛴", charging_stations: "🔋",
      drones_overhead: "🚁", smart_road: "🛣️", submarine_drones: "🤿",
      wind_turbines_obs: "🌀"
    };
    const icon = icons[f] || "⚡";
    const lx = W - 80 + (i % 2) * 20;
    const ly = 10 + Math.floor(i / 2) * 20;
    ctx.font = "12px serif";
    ctx.textAlign = "center";
    ctx.fillText(icon, lx, ly + 10);
  });
}

function drawFeatures(ctx, W, H, ts) {
  const features = G.mapData?.tiles?.features || [];
  ctx.save();
  ctx.globalAlpha = 0.25;

  features.forEach((feat, i) => {
    const x = (2 + i * 3) * ts % W;
    const y = (1 + i * 2) * ts % H;

    switch(feat) {
      case "solar_panels":
        ctx.fillStyle = "#F7DC6F";
        ctx.fillRect(x, y, ts * 2, ts);
        ctx.fillStyle = "#1a3a1a";
        for (let r = 0; r < 2; r++)
          for (let c = 0; c < 4; c++)
            ctx.fillRect(x + c * (ts/2) + 2, y + r * (ts/2) + 2, ts/2-4, ts/2-4);
        break;
      case "wind_turbines":
        ctx.strokeStyle = "#aaa";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + ts/2, y); ctx.lineTo(x + ts/2, y + ts * 3); ctx.stroke();
        // Blades
        for (let b = 0; b < 3; b++) {
          ctx.beginPath();
          const ang = (b * 120 + (Date.now() / 100)) * Math.PI / 180;
          ctx.moveTo(x + ts/2, y);
          ctx.lineTo(x + ts/2 + Math.cos(ang) * ts, y + Math.sin(ang) * ts);
          ctx.stroke();
        }
        break;
      case "atlas_barber_salon":
        ctx.fillStyle = "#8E44AD";
        ctx.fillRect(x, y, ts * 2, ts * 2);
        ctx.fillStyle = "#C9A84C";
        ctx.font = "20px serif";
        ctx.textAlign = "center";
        ctx.fillText("✂️", x + ts, y + ts);
        break;
    }
  });

  ctx.restore();
}

// ============================================================
// PLAYER MOVEMENT
// ============================================================
function movePlayer(dir) {
  if (!G.save || G.moving) return;
  G.moving = true;

  const dirMap = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
  const [dx, dy] = dirMap[dir] || [0, 0];

  G.save.location.x += dx;
  G.save.location.y += dy;
  G.save.player.steps = (G.save.player.steps || 0) + 1;

  // Animate camera
  const targetCamX = G.camera.x + dx * G.tileSize;
  const targetCamY = G.camera.y + dy * G.tileSize;
  animateCamera(targetCamX, targetCamY, () => {
    G.moving = false;
    handleTileArrival();
  });
}

function animateCamera(tx, ty, cb) {
  const steps = 6;
  let step = 0;
  const dx = (tx - G.camera.x) / steps;
  const dy = (ty - G.camera.y) / steps;

  const anim = () => {
    G.camera.x += dx;
    G.camera.y += dy;
    renderWorld();
    step++;
    if (step < steps) requestAnimationFrame(anim);
    else {
      G.camera.x = tx;
      G.camera.y = ty;
      renderWorld();
      cb && cb();
    }
  };
  requestAnimationFrame(anim);
}

async function handleTileArrival() {
  if (!G.save || !G.mapData) return;
  const { x, y } = G.save.location;

  // Check NPC collision
  const npc = (G.mapData.npcs || []).find(n => n.position?.x === x && n.position?.y === y);
  if (npc) {
    interactWithNPC(npc);
    return;
  }

  // Check item pickup
  const item = (G.mapData.items || []).find(it => it.x === x && it.y === y);
  if (item) {
    pickupItem(item);
    return;
  }

  // Wild encounter
  const wilds = G.mapData.wild_encounters || [];
  if (wilds.length > 0 && Math.random() < 0.12) {
    const encounter = weightedPick(wilds);
    if (encounter) {
      triggerWildEncounter(encounter);
    }
  }
}

function weightedPick(encounters) {
  const total = encounters.reduce((s, e) => s + (e.chance || 10), 0);
  let rand = Math.random() * total;
  for (const enc of encounters) {
    rand -= enc.chance || 10;
    if (rand <= 0) return enc;
  }
  return encounters[0];
}

// ============================================================
// ACTION BUTTONS
// ============================================================
function actionA() {
  // Interact with nearby NPC or advance dialog
  if (document.getElementById("dialog-box").style.display !== "none") {
    advanceDialog();
    return;
  }
  // Check for adjacent NPC
  const { x, y } = G.save?.location || { x: 0, y: 0 };
  const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
  for (const [dx, dy] of dirs) {
    const npc = (G.mapData?.npcs || []).find(n => n.position?.x === x + dx && n.position?.y === y + dy);
    if (npc) { interactWithNPC(npc); return; }
  }
}

function actionB() {
  // Close dialog or cancel
  if (document.getElementById("dialog-box").style.display !== "none") {
    closeDialog();
  }
}

function openTeam() { showScreen("screen-team"); }
function openBag()  { showScreen("screen-bag"); }

// ============================================================
// NPC INTERACTION
// ============================================================
function interactWithNPC(npc) {
  const lines = npc.dialog || ["..."];

  // Special NPC logic
  if (npc.id === "npc_panthera" && !G.save.flags.met_panthera) {
    G.save.flags.met_panthera = true;
  }
  if (npc.id === "npc_elf" && !G.save.flags.met_elf) {
    G.save.flags.met_elf = true;
  }

  // Shop NPC
  if (npc.role === "shop" && npc.shop) {
    openShop(npc);
    return;
  }

  // Trainer battle
  if (npc.battle && !G.save.flags[`beaten_${npc.id}`]) {
    startDialogSequence(npc.sprite || "👤", npc.name, lines, () => {
      startTrainerBattle(npc);
    });
    return;
  }

  startDialogSequence(npc.sprite || "👤", npc.name, lines);
}

function startDialogSequence(portrait, name, lines, onEnd = null) {
  G.dialog = { lines, index: 0, onEnd };
  const box = document.getElementById("dialog-box");
  document.getElementById("dialog-portrait").textContent = portrait;
  document.getElementById("dialog-name").textContent = name;
  box.style.display = "flex";
  typewriterEffect(lines[0]);
}

function advanceDialog() {
  G.dialog.index++;
  if (G.dialog.index < G.dialog.lines.length) {
    typewriterEffect(G.dialog.lines[G.dialog.index]);
  } else {
    closeDialog();
    if (G.dialog.onEnd) G.dialog.onEnd();
  }
}

function closeDialog() {
  document.getElementById("dialog-box").style.display = "none";
  G.dialog = { lines: [], index: 0, npc: null, onEnd: null };
}

function typewriterEffect(text) {
  const el = document.getElementById("dialog-text");
  el.textContent = "";
  let i = 0;
  const speed = 25;
  const type = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(type, speed);
    }
  };
  type();
}

// ============================================================
// ITEM PICKUP
// ============================================================
function pickupItem(item) {
  const name = item.name;
  if (!G.save.inventory[name]) G.save.inventory[name] = 0;
  G.save.inventory[name]++;
  // Remove from map items (flag)
  if (!G.save.flags[`picked_${item.id}`]) {
    G.save.flags[`picked_${item.id}`] = true;
    showToast(`🎒 Trovato: ${name}!`);
  }
}

// ============================================================
// SHOP
// ============================================================
function openShop(npc) {
  const stock = npc.shop?.stock || [];
  const lines = [
    `Benvenuto da ${npc.name}!`,
    "Ecco cosa abbiamo in magazzino:",
    ...stock.map(s => `${s.name} — ${s.price}¢`),
    "Acquista dall'inventario del menu."
  ];
  startDialogSequence(npc.sprite || "🏪", npc.name, lines);
}

// ============================================================
// WILD ENCOUNTER
// ============================================================
function triggerWildEncounter(encounter) {
  const flash = document.getElementById("encounter-flash");
  flash.style.display = "flex";

  setTimeout(() => {
    flash.style.display = "none";
    const level = randInt(encounter.level_min, encounter.level_max);
    const wildAeon = buildAeon(encounter.creature, level);
    if (!wildAeon) return;

    // Update codex (seen)
    if (!G.save.codex[encounter.creature]) {
      G.save.codex[encounter.creature] = { seen: true, caught: false };
    }

    startBattle("wild", wildAeon);
  }, 800);
}

// ============================================================
// BATTLE SYSTEM
// ============================================================
function startBattle(type, opponent, trainerData = null) {
  G.battle = {
    type,
    opponent,         // wild aeon OR trainer's current aeon
    trainerData,
    trainerTeamIdx: 0,
    playerTeamIdx: 0,
    turn: 0,
    log: [],
    result: null,
    charging: false   // for 2-turn moves
  };

  const playerAeon = G.save.team[0];
  showScreen("screen-battle");
  updateBattleUI();

  const intro = type === "wild"
    ? `Un ${opponent.name} selvaggio è apparso!`
    : `${trainerData?.name || "Trainer"} vuole combattere! Forza ${opponent.name}!`;
  setBattleLog(intro);
  showMainMenu();

  // Detect terrain from current map
  const terrain = G.mapData?.tiles?.terrain || "urban_future";
  styleBattleTerrain(terrain);
}

function startTrainerBattle(npc) {
  if (!npc.battle) return;
  const trainerTeam = npc.battle.team.map(t => buildAeon(t.creature, t.level));
  G.battle = {
    type: "trainer",
    trainerData: { ...npc.battle, npcId: npc.id },
    trainerTeam,
    trainerTeamIdx: 0,
    opponent: trainerTeam[0],
    playerTeamIdx: 0,
    turn: 0,
    log: [],
    result: null
  };
  showScreen("screen-battle");
  updateBattleUI();
  setBattleLog(`${npc.battle.name} vuole combattere!`);
  showMainMenu();
}

function styleBattleTerrain(terrain) {
  const terrainEl = document.getElementById("battle-terrain");
  const labels = {
    urban_future: "ATLAS HUB · SMART CITY",
    field:        "SOLAR FIELDS · ROUTE",
    highway:      "ECO ROUTE · HIGHWAY",
    ridge:        "WIND RIDGE · TURBINE ZONE",
    coastal:      "HYDRO COAST · OCEAN",
    urban_stylish:"BARBER DISTRICT",
    industrial:   "INDUSTRIAL ZONE",
    elite:        "ATLAS COUNCIL CHAMBER",
    digital:      "DEEP SERVER · DATA CENTER"
  };
  terrainEl.textContent = labels[terrain] || "ATLAS VALLEY";
}

function updateBattleUI() {
  if (!G.battle || !G.save) return;
  const player = G.save.team[G.battle.playerTeamIdx];
  const enemy  = G.battle.opponent;

  if (!player || !enemy) return;

  // Enemy
  setText("enemy-name", enemy.name);
  setText("enemy-level", enemy.level);
  setText("enemy-type", getTypeEmoji(enemy.type) + " " + enemy.type);
  setText("enemy-hp-numbers", "— / —");
  setText("enemy-sprite", enemy.sprite || "?");
  setHPBar("enemy-hp-bar", enemy.current_hp, enemy.stats.hp);

  // Player
  setText("player-aeon-name", player.name);
  setText("player-level", player.level);
  setText("player-type", getTypeEmoji(player.type));
  setText("player-hp-numbers", `${player.current_hp} / ${player.stats.hp}`);
  setText("player-sprite", G.save.player.character === "elf_wizard" ? "🧝" : "🐾");
  setHPBar("player-hp-bar", player.current_hp, player.stats.hp);
  setXPBar("player-xp-bar", player.xp || 0, player.xp_next || 100);
}

// Battle menus
function showMainMenu()  {
  show("battle-main-menu");
  hide("battle-move-menu");
  hide("battle-bag-menu");
  hide("battle-switch-menu");
}

function showMoveMenu() {
  const player = G.save.team[G.battle.playerTeamIdx];
  const grid = document.getElementById("moves-grid");
  grid.innerHTML = "";
  player.moves.forEach(moveName => {
    const move = G.moves[moveName] || { name: moveName, type: "NORMAL", power: 40, pp: 10 };
    const btn = document.createElement("button");
    btn.className = "move-btn";
    btn.innerHTML = `
      <span class="move-btn-name">${moveName.replace(/-/g," ").toUpperCase()}</span>
      <span class="move-btn-meta">${move.type} · PWR ${move.power || "—"} · PP ${move.pp || "—"}</span>
    `;
    btn.onclick = () => executeFight(moveName);
    grid.appendChild(btn);
  });
  hide("battle-main-menu"); show("battle-move-menu");
  hide("battle-bag-menu"); hide("battle-switch-menu");
}

function showBagMenu() {
  const list = document.getElementById("bag-items-list");
  list.innerHTML = "";
  const inv = G.save.inventory;
  const usableInBattle = ["NanoCell", "MaxCell", "HyperCell", "UltraCell", "AEONball", "GreatAEONball", "UltraAEONball", "Revive Chip", "Antidote Patch", "Burn Gel", "Paralysis Chip"];
  const entries = Object.entries(inv).filter(([k, v]) => v > 0 && usableInBattle.includes(k));

  if (!entries.length) {
    list.innerHTML = '<div style="padding:0.5rem;color:var(--grey);font-size:0.8rem;">Nessun oggetto usabile in battaglia.</div>';
  } else {
    entries.forEach(([name, qty]) => {
      const item = G.items[name] || { emoji: "📦" };
      const btn = document.createElement("button");
      btn.className = "bag-item-btn";
      btn.innerHTML = `<span>${item.emoji || "📦"}</span><span>${name} ×${qty}</span>`;
      btn.onclick = () => executeItem(name);
      list.appendChild(btn);
    });
  }
  hide("battle-main-menu"); hide("battle-move-menu");
  show("battle-bag-menu"); hide("battle-switch-menu");
}

function showSwitchMenu() {
  const list = document.getElementById("switch-list");
  list.innerHTML = "";
  G.save.team.forEach((aeon, i) => {
    if (i === G.battle.playerTeamIdx) return;
    if (aeon.current_hp <= 0) return;
    const btn = document.createElement("button");
    btn.className = "switch-btn";
    btn.innerHTML = `<span>${aeon.sprite}</span><span>${aeon.name} Lv.${aeon.level} · HP ${aeon.current_hp}/${aeon.stats.hp}</span>`;
    btn.onclick = () => executeSwitch(i);
    list.appendChild(btn);
  });
  hide("battle-main-menu"); hide("battle-move-menu");
  hide("battle-bag-menu"); show("battle-switch-menu");
}

// ============================================================
// BATTLE ACTIONS
// ============================================================
function executeFight(moveName) {
  if (!G.battle) return;
  showMainMenu();

  const player = G.save.team[G.battle.playerTeamIdx];
  const enemy  = G.battle.opponent;
  const move   = G.moves[moveName] || { name: moveName, type: "NORMAL", power: 40, accuracy: 100, damage_class: "physical" };

  const log = [];

  const playerFirst = player.stats.spe >= enemy.stats.spe;

  if (playerFirst) {
    const [dmg, msg] = calcDamage(player, enemy, move);
    enemy.current_hp = Math.max(0, enemy.current_hp - dmg);
    log.push(msg);
    if (enemy.current_hp > 0) {
      const aiMsgs = aiTurn(enemy, player);
      log.push(...aiMsgs);
    }
  } else {
    const aiMsgs = aiTurn(enemy, player);
    log.push(...aiMsgs);
    if (player.current_hp > 0) {
      const [dmg, msg] = calcDamage(player, enemy, move);
      enemy.current_hp = Math.max(0, enemy.current_hp - dmg);
      log.push(msg);
    }
  }

  G.battle.turn++;
  updateBattleUI();
  showBattleLog(log, () => checkBattleEnd());
}

function executeItem(itemName) {
  showMainMenu();
  const player = G.save.team[G.battle.playerTeamIdx];
  const enemy  = G.battle.opponent;
  const item   = G.items[itemName];
  const log    = [];

  if (!item || !G.save.inventory[itemName] || G.save.inventory[itemName] <= 0) {
    setBattleLog("Oggetto non disponibile!");
    return;
  }

  G.save.inventory[itemName]--;

  if (item.effect === "heal") {
    const old = player.current_hp;
    player.current_hp = Math.min(player.stats.hp, player.current_hp + item.value);
    log.push(`Usato ${itemName}! ${player.name} recupera ${player.current_hp - old} HP!`);
  } else if (item.effect === "full_heal") {
    player.current_hp = player.stats.hp;
    player.status = null;
    log.push(`${player.name} è completamente guarito!`);
  } else if (item.effect === "capture" && G.battle.type === "wild") {
    const success = attemptCapture(enemy, item.value || 1.0);
    if (success) {
      log.push(`${enemy.name} catturato!`);
      G.battle.result = "captured";
      updateBattleUI();
      showBattleLog(log, () => endBattle("captured", enemy));
      return;
    } else {
      const shakes = randInt(1, 3);
      log.push(`Quasi! ${enemy.name} si è liberato! (${shakes} oscillazion${shakes === 1 ? "e" : "i"})`);
    }
  } else if (item.effect === "revive") {
    player.current_hp = Math.floor(player.stats.hp * item.value);
    log.push(`${player.name} è stato rianimato!`);
  }

  // AI attacks after item
  if (enemy.current_hp > 0 && player.current_hp > 0) {
    const aiMsgs = aiTurn(enemy, player);
    log.push(...aiMsgs);
  }

  updateBattleUI();
  showBattleLog(log, () => checkBattleEnd());
}

function executeSwitch(idx) {
  showMainMenu();
  G.battle.playerTeamIdx = idx;
  const newAeon = G.save.team[idx];
  const enemy = G.battle.opponent;
  const log = [`Vai, ${newAeon.name}!`];

  // Enemy attacks on switch
  const aiMsgs = aiTurn(enemy, newAeon);
  log.push(...aiMsgs);

  updateBattleUI();
  showBattleLog(log, () => checkBattleEnd());
}

function runFromBattle() {
  if (G.battle?.type !== "wild") {
    setBattleLog("Non puoi fuggire da un combattimento con un Trainer!");
    return;
  }
  const success = Math.random() < 0.65;
  if (success) {
    showBattleLog(["Sei scappato in sicurezza!"], () => exitBattle());
  } else {
    const enemy = G.battle.opponent;
    const log = ["Non riesci a fuggire!"];
    const aiMsgs = aiTurn(enemy, G.save.team[G.battle.playerTeamIdx]);
    log.push(...aiMsgs);
    updateBattleUI();
    showBattleLog(log, () => checkBattleEnd());
  }
}

// ============================================================
// DAMAGE CALC
// ============================================================
function calcDamage(attacker, defender, move) {
  if (!move.power || move.power === 0 || move.damage_class === "status") {
    return [0, `${attacker.name} usa ${move.name.replace(/-/g," ").toUpperCase()}!`];
  }

  const lv = attacker.level;
  const isPhys = move.damage_class === "physical";
  const atk = isPhys ? attacker.stats.atk : attacker.stats.spa;
  const def = isPhys ? defender.stats.def : defender.stats.spd;
  const power = move.power;
  const moveType = (move.type || "NORMAL").toUpperCase();

  let dmg = Math.floor(((2 * lv / 5 + 2) * power * atk / def) / 50 + 2);

  // STAB
  if (moveType === attacker.type) dmg = Math.floor(dmg * 1.5);

  // Type chart
  const eff = getTypeEffectiveness(moveType, defender.type);
  dmg = Math.floor(dmg * eff);

  // Random
  dmg = Math.floor(dmg * (0.85 + Math.random() * 0.15));
  dmg = Math.max(1, dmg);

  // Drain
  if (move.drain > 0) {
    const restore = Math.floor(dmg * move.drain / 100);
    attacker.current_hp = Math.min(attacker.stats.hp, attacker.current_hp + restore);
  } else if (move.drain < 0) {
    const recoil = Math.floor(dmg * Math.abs(move.drain) / 100);
    attacker.current_hp = Math.max(0, attacker.current_hp - recoil);
  }

  const effText = eff >= 2 ? " Super efficace!" : eff === 0 ? " Nessun effetto." : eff < 1 ? " Non molto efficace..." : "";
  const msg = `${attacker.name} usa ${move.name.replace(/-/g," ").toUpperCase()}! ${defender.name} subisce ${dmg} danni!${effText}`;
  return [dmg, msg];
}

function getTypeEffectiveness(atk, def) {
  // Simplified inline chart
  const chart = {
    ELECTRIC: { WATER: 2, FLYING: 2, ELECTRIC: 0.5, GRASS: 0.5, GROUND: 0 },
    GRASS:    { WATER: 2, GROUND: 2, ROCK: 2, FIRE: 0.5, GRASS: 0.5, FLYING: 0.5 },
    WATER:    { FIRE: 2, GROUND: 2, ROCK: 2, WATER: 0.5, GRASS: 0.5 },
    FIRE:     { GRASS: 2, ICE: 2, BUG: 2, STEEL: 2, WATER: 0.5, FIRE: 0.5 },
    FLYING:   { GRASS: 2, FIGHTING: 2, BUG: 2, ELECTRIC: 0.5, ROCK: 0.5 },
    STEEL:    { ICE: 2, ROCK: 2, FAIRY: 2, FIRE: 0.5, WATER: 0.5, ELECTRIC: 0.5 },
    GHOST:    { GHOST: 2, PSYCHIC: 2, DARK: 0.5, NORMAL: 0 },
    DARK:     { GHOST: 2, PSYCHIC: 2, FIGHTING: 0.5, DARK: 0.5 },
    PSYCHIC:  { FIGHTING: 2, POISON: 2, PSYCHIC: 0.5, DARK: 0, GHOST: 0 },
    NORMAL:   { STEEL: 0.5, GHOST: 0 }
  };
  return chart[atk]?.[def] ?? 1.0;
}

function attemptCapture(enemy, ballMod = 1.0) {
  const maxHp = enemy.stats.hp;
  const curHp = enemy.current_hp;
  const catchRate = enemy.catch_rate || 45;
  const a = ((3 * maxHp - 2 * curHp) * catchRate * ballMod) / (3 * maxHp);
  return Math.random() < a / 255;
}

function aiTurn(enemy, player) {
  const moves = enemy.moves || ["tackle"];
  const moveName = moves[randInt(0, moves.length - 1)];
  const move = G.moves[moveName] || { name: moveName, type: "NORMAL", power: 40, accuracy: 100, damage_class: "physical" };
  const [dmg, msg] = calcDamage(enemy, player, move);
  player.current_hp = Math.max(0, player.current_hp - dmg);
  return [msg];
}

// ============================================================
// BATTLE END
// ============================================================
function checkBattleEnd() {
  if (!G.battle) return;
  const player = G.save.team[G.battle.playerTeamIdx];
  const enemy  = G.battle.opponent;

  if (enemy.current_hp <= 0) {
    const xp = Math.floor(enemy.stats.hp * enemy.level * 0.5);
    player.xp = (player.xp || 0) + xp;

    // Trainer: next mon?
    if (G.battle.type === "trainer" && G.battle.trainerTeam) {
      G.battle.trainerTeamIdx++;
      if (G.battle.trainerTeamIdx < G.battle.trainerTeam.length) {
        const nextMon = G.battle.trainerTeam[G.battle.trainerTeamIdx];
        G.battle.opponent = nextMon;
        updateBattleUI();
        showBattleLog([`${enemy.name} è esausto! Forza ${nextMon.name}!`], showMainMenu);
        return;
      }
    }

    // Level up check
    while (player.xp >= player.xp_next) {
      player.level++;
      player.xp -= player.xp_next;
      player.xp_next = Math.pow(player.level, 3);
      // Recalc HP
      const newHp = Math.floor((2 * G.creatures[player.creature_id]?.hp * player.level) / 100) + player.level + 10;
      player.stats.hp = newHp;
      player.current_hp = Math.min(player.current_hp + 10, newHp);
    }

    G.save.player.battles_won = (G.save.player.battles_won || 0) + 1;
    endBattle("win", enemy);
    return;
  }

  const allFainted = G.save.team.every(a => a.current_hp <= 0);
  if (allFainted) {
    G.save.player.battles_lost = (G.save.player.battles_lost || 0) + 1;
    G.save.player.credits = Math.max(0, (G.save.player.credits || 0) - 100);
    endBattle("lose", enemy);
    return;
  }

  if (player.current_hp <= 0) {
    const nextAlive = G.save.team.findIndex((a, i) => i !== G.battle.playerTeamIdx && a.current_hp > 0);
    if (nextAlive >= 0) {
      G.battle.playerTeamIdx = nextAlive;
      updateBattleUI();
      showBattleLog([`${player.name} è esausto! Forza ${G.save.team[nextAlive].name}!`], showMainMenu);
    }
  }
}

function endBattle(result, enemy) {
  const overlay = document.getElementById("battle-result-overlay");
  const content = document.getElementById("battle-result-content");

  if (result === "win") {
    const reward = G.battle.trainerData?.reward || 0;
    if (reward) G.save.player.credits = (G.save.player.credits || 0) + reward;

    // Mark trainer beaten
    if (G.battle.trainerData?.npcId) {
      G.save.flags[`beaten_${G.battle.trainerData.npcId}`] = true;
    }

    content.innerHTML = `
      <div style="text-align:center;padding:1rem;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">🏆</div>
        <div style="font-family:'Bebas Neue';font-size:1.8rem;color:var(--gold);letter-spacing:0.15em;">VITTORIA!</div>
        <p style="color:var(--grey);margin:0.5rem 0;">${enemy.name} è stato sconfitto!</p>
        ${reward ? `<p style="color:var(--gold);">+${reward}¢</p>` : ""}
      </div>
    `;
  } else if (result === "captured") {
    // Add to team or box
    if (G.save.team.length < 6) {
      G.save.team.push(enemy);
    } else {
      G.save.box.push(enemy);
    }
    G.save.codex[enemy.creature_id] = { seen: true, caught: true };

    content.innerHTML = `
      <div style="text-align:center;padding:1rem;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">${enemy.sprite}</div>
        <div style="font-family:'Bebas Neue';font-size:1.8rem;color:var(--cyan);letter-spacing:0.15em;">CATTURATO!</div>
        <p style="color:var(--grey);">${enemy.name} si è unito al tuo team!</p>
      </div>
    `;
  } else if (result === "lose") {
    content.innerHTML = `
      <div style="text-align:center;padding:1rem;">
        <div style="font-size:2.5rem;margin-bottom:0.5rem;">💀</div>
        <div style="font-family:'Bebas Neue';font-size:1.8rem;color:var(--red);letter-spacing:0.15em;">SCONFITTO!</div>
        <p style="color:var(--grey);">I tuoi AEON sono tutti esausti. Hai perso 100¢.</p>
      </div>
    `;
    // Heal team to 1 HP
    G.save.team.forEach(a => { if (a.current_hp <= 0) a.current_hp = 1; });
  }

  overlay.style.display = "flex";
  saveGame();
}

function exitBattle() {
  document.getElementById("battle-result-overlay").style.display = "none";
  G.battle = null;
  showScreen("screen-game");
  updateQuickTeam();
}

// ============================================================
// INTRO SEQUENCE
// ============================================================
function startIntroSequence() {
  if (!G.save) return;
  const name = G.save.player.name;
  const char = G.save.player.character;
  const charSprite = char === "elf_wizard" ? "🧝" : "🐾";

  const lines = [
    `Benvenuto in Atlas Valley, ${name}!`,
    "Questo è un mondo alimentato da sole, vento e idrogeno.",
    "Le creature che abitano questo ecosistema si chiamano AEON.",
    "Io sono panthera_leo, co-fondatore di Atlas Valley.",
    "Il tuo viaggio come AEONista comincia ora.",
    "Esplora, cattura AEON, sfida i Gym Leader.",
    "Diventa il Campione dell'Atlas Council.",
    "In bocca al lupo, AEONista!"
  ];

  startDialogSequence(charSprite, "panthera_leo", lines, () => {
    showToast("⚡ Avventura iniziata! Usa il D-pad per muoverti.");
  });
}

// ============================================================
// RENDER: TEAM, BAG, CODEX, MAP
// ============================================================
function renderTeam() {
  if (!G.save) return;
  const list = document.getElementById("team-list");
  list.innerHTML = "";

  if (!G.save.team.length) {
    list.innerHTML = '<div style="padding:2rem;color:var(--grey);text-align:center;">Nessun AEON nel team.</div>';
    return;
  }

  G.save.team.forEach((aeon, i) => {
    const hpPct = Math.max(0, (aeon.current_hp / aeon.stats.hp) * 100);
    const hpClass = hpPct > 50 ? "" : hpPct > 20 ? "yellow" : "red";
    const card = document.createElement("div");
    card.className = "team-card";
    card.innerHTML = `
      <div class="tc-sprite">${aeon.sprite}</div>
      <div class="tc-info">
        <div class="tc-name">${aeon.name}</div>
        <div class="tc-level">Lv.${aeon.level} · ${aeon.type} · ${getTypeEmoji(aeon.type)}</div>
        <div class="tc-hp">
          <div class="tc-hp-bar"><div class="tc-hp-fill ${hpClass}" style="width:${hpPct}%"></div></div>
          <div class="tc-hp-text">${aeon.current_hp}/${aeon.stats.hp}</div>
        </div>
        <div class="tc-moves">Mosse: ${aeon.moves.join(", ")}</div>
        ${aeon.status ? `<div class="tc-status">${aeon.status.toUpperCase()}</div>` : ""}
      </div>
    `;
    list.appendChild(card);
  });
}

function renderBag() {
  if (!G.save) return;
  const list = document.getElementById("bag-list");
  list.innerHTML = "";
  const entries = Object.entries(G.save.inventory).filter(([,v]) => v > 0);

  if (!entries.length) {
    list.innerHTML = '<div style="padding:2rem;color:var(--grey);grid-column:1/-1;text-align:center;">Zaino vuoto.</div>';
    return;
  }

  entries.forEach(([name, qty]) => {
    const item = G.items[name] || { emoji: "📦", desc: "" };
    const card = document.createElement("div");
    card.className = "bag-card";
    card.innerHTML = `
      <div class="bag-emoji">${item.emoji || "📦"}</div>
      <div class="bag-name">${name}</div>
      <div class="bag-qty">×${qty}</div>
      <div class="bag-desc">${item.desc || ""}</div>
    `;
    list.appendChild(card);
  });
}

function renderCodex() {
  const grid = document.getElementById("codex-grid");
  if (!grid) return;
  grid.innerHTML = "";

  Object.entries(G.creatures).forEach(([key, c]) => {
    const codexEntry = G.save?.codex?.[key] || {};
    const seen   = codexEntry.seen || false;
    const caught = codexEntry.caught || false;

    const card = document.createElement("div");
    card.className = `codex-card ${caught ? "caught" : seen ? "seen" : "codex-locked"}`;
    card.innerHTML = `
      ${caught ? '<div class="codex-caught-badge">✓ CATTURATO</div>' : ""}
      <div class="codex-num">#${String(c.index).padStart(3,"0")}</div>
      <div class="codex-sprite">${c.sprite || "?"}</div>
      <div class="codex-name">${seen ? c.name : "????"}</div>
      <div class="codex-type-badge">${seen ? c.type : "???"}</div>
      ${seen ? `<div class="codex-desc">${c.desc || ""}</div>` : ""}
    `;
    grid.appendChild(card);
  });
}

function renderMenuInfo() {
  if (!G.save) return;
  const el = document.getElementById("menu-player-info");
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.4rem;">
      <div style="font-family:'Bebas Neue';font-size:1.1rem;letter-spacing:0.1em;color:var(--gold);">
        ${G.save.player.character === "elf_wizard" ? "🧝" : "🐾"} ${G.save.player.name}
      </div>
      <div style="font-size:0.65rem;color:var(--grey);display:flex;gap:1rem;flex-wrap:wrap;">
        <span>💰 ${G.save.player.credits}¢</span>
        <span>🏆 ${(G.save.player.badges||[]).length}/5 Badge</span>
        <span>⚔️ ${G.save.player.battles_won||0} vittorie</span>
        <span>📍 ${G.world[G.save.location?.map]?.name || "Atlas Hub"}</span>
        <span>👥 ${G.save.team.length}/6 AEON</span>
        <span>📖 ${Object.values(G.save.codex||{}).filter(v=>v.caught).length}/${Object.keys(G.creatures).length} catturati</span>
      </div>
      <div style="font-size:0.55rem;color:rgba(138,145,158,0.4);margin-top:0.3rem;">Player ID: ${G.playerId || "—"}</div>
    </div>
  `;
}

function updateQuickTeam() {
  if (!G.save) return;
  const el = document.getElementById("quick-team");
  if (!el) return;
  el.innerHTML = "";
  G.save.team.slice(0, 3).forEach(aeon => {
    const hpPct = Math.max(0, (aeon.current_hp / aeon.stats.hp) * 100);
    const hpClass = hpPct > 50 ? "" : hpPct > 20 ? "yellow" : "red";
    el.innerHTML += `
      <div class="qt-item">
        <span class="qt-sprite">${aeon.sprite}</span>
        <span class="qt-name">${aeon.name} Lv${aeon.level}</span>
        <div class="qt-hp-bar"><div class="qt-hp-fill ${hpClass}" style="width:${hpPct}%"></div></div>
      </div>
    `;
  });
}

function updateHUDLocation() {
  if (!G.save) return;
  const mapName = G.world[G.save.location?.map]?.name || "Atlas Hub";
  setText("hud-map-name", mapName);
}

// ============================================================
// WORLD MAP SVG
// ============================================================
function renderWorldMap() {
  const container = document.getElementById("world-map-svg");
  if (!container) return;

  const nodes = [
    { id: "atlas-hub",      x: 200, y: 200, label: "Atlas Hub",      type: "city",   gym: true },
    { id: "barber-district",x: 310, y: 200, label: "Barber District", type: "district" },
    { id: "solar-fields",   x: 90,  y: 200, label: "Solar Fields",    type: "route" },
    { id: "route-1",        x: 200, y: 100, label: "Eco Route 1",     type: "route" },
    { id: "nova-city",      x: 200, y: 20,  label: "Nova City",       type: "city",   gym: true },
    { id: "wind-ridge",     x: 80,  y: 20,  label: "Wind Ridge",      type: "route" },
    { id: "hydro-coast",    x: 320, y: 20,  label: "Hydro Coast",     type: "route" },
    { id: "deep-server",    x: 320, y: -60, label: "Deep Server",     type: "city",   gym: true },
    { id: "atlas-council",  x: 200, y: -140, label: "Atlas Council",  type: "elite" }
  ];

  const edges = [
    ["atlas-hub","barber-district"], ["atlas-hub","solar-fields"],
    ["atlas-hub","route-1"], ["route-1","nova-city"],
    ["nova-city","wind-ridge"], ["nova-city","hydro-coast"],
    ["hydro-coast","deep-server"], ["deep-server","atlas-council"]
  ];

  // Normalize Y (flip)
  const minY = Math.min(...nodes.map(n => n.y));
  const maxY = Math.max(...nodes.map(n => n.y));
  const norm = nodes.map(n => ({ ...n, cy: maxY - n.y + 20 }));
  const nodeMap = {};
  norm.forEach(n => nodeMap[n.id] = n);

  const svgH = maxY - minY + 80;

  let svg = `<svg viewBox="0 0 420 ${svgH}" width="100%" style="max-width:420px">
    <defs>
      <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;

  // Edges
  edges.forEach(([a, b]) => {
    const na = nodeMap[a], nb = nodeMap[b];
    if (!na || !nb) return;
    svg += `<line x1="${na.x}" y1="${na.cy}" x2="${nb.x}" y2="${nb.cy}"
      stroke="rgba(201,168,76,0.3)" stroke-width="2" stroke-dasharray="4,4"/>`;
  });

  // Nodes
  norm.forEach(n => {
    const isActive = G.save?.location?.map === n.id;
    const color = n.type === "city" ? "#c9a84c" : n.type === "elite" ? "#e74c3c" : "#5dade2";
    const icon = n.type === "city" ? "🏙️" : n.type === "elite" ? "👑" : "🌿";
    const r = isActive ? 12 : 8;

    svg += `
      <circle cx="${n.x}" cy="${n.cy}" r="${r}" fill="${color}" opacity="0.2"
        filter="url(#glow)" ${isActive ? 'stroke="#c9a84c" stroke-width="2"' : ""}/>
      <circle cx="${n.x}" cy="${n.cy}" r="${r / 2}" fill="${color}" opacity="0.8"/>
      <text x="${n.x}" y="${n.cy - r - 6}" text-anchor="middle"
        font-family="'Share Tech Mono'" font-size="8" fill="${color}">${n.label}</text>
      <text x="${n.x}" y="${n.cy + r + 12}" text-anchor="middle" font-size="10">${icon}${n.gym ? "⚡" : ""}</text>
      ${isActive ? `<circle cx="${n.x}" cy="${n.cy}" r="${r + 6}" fill="none" stroke="#c9a84c" stroke-width="1" opacity="0.5" stroke-dasharray="3,3"/>` : ""}
    `;
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}

// ============================================================
// SQL SCHEMA
// ============================================================
function loadSQLSchema() {
  const schema = `-- ============================================================
-- AAO (Atlas Art Online) — Supabase PostgreSQL Schema
-- Organization: pantheraleo-atlasvalley-AAO
-- Project: AAO
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- PLAYERS
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    character TEXT DEFAULT 'panthera_leo',
    save_data JSONB NOT NULL DEFAULT '{}',
    badges_count INT DEFAULT 0,
    battles_won INT DEFAULT 0,
    battles_lost INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read_own" ON players FOR SELECT USING (true);
CREATE POLICY "insert_own" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "update_own" ON players FOR UPDATE USING (true);

-- CODEX
CREATE TABLE IF NOT EXISTS codex (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    creature_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    seen BOOLEAN DEFAULT true,
    caught BOOLEAN DEFAULT false,
    UNIQUE(player_id, creature_id)
);
ALTER TABLE codex ENABLE ROW LEVEL SECURITY;
CREATE POLICY "codex_read" ON codex FOR SELECT USING (true);
CREATE POLICY "codex_insert" ON codex FOR INSERT WITH CHECK (true);

-- BATTLE_LOG
CREATE TABLE IF NOT EXISTS battle_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    battle_type TEXT NOT NULL,
    opponent_name TEXT,
    result TEXT NOT NULL,
    turns INT DEFAULT 0,
    map_id TEXT,
    credits_earned INT DEFAULT 0,
    played_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE battle_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "log_read" ON battle_log FOR SELECT USING (true);
CREATE POLICY "log_insert" ON battle_log FOR INSERT WITH CHECK (true);

-- LEADERBOARD VIEW
CREATE OR REPLACE VIEW leaderboard AS
    SELECT name, character, battles_won, battles_lost, badges_count, created_at
    FROM players ORDER BY battles_won DESC, badges_count DESC LIMIT 100;

-- AUTO-UPDATED_AT
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER players_updated_at BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_players_battles ON players(battles_won DESC);
CREATE INDEX IF NOT EXISTS idx_codex_player ON codex(player_id);
CREATE INDEX IF NOT EXISTS idx_log_player ON battle_log(player_id);`;

  G.sqlSchema = schema;
  const el = document.getElementById("sql-schema-display");
  if (el) el.textContent = schema;
}

function copySchema() {
  navigator.clipboard.writeText(G.sqlSchema).then(() => showToast("📋 Schema copiato!"));
}

function saveSupabaseConfig() {
  const url = document.getElementById("sql-url")?.value.trim();
  const key = document.getElementById("sql-key")?.value.trim();
  if (!url || !key) return showToast("⚠️ Inserisci URL e Key.");
  localStorage.setItem("aao_supabase_url", url);
  localStorage.setItem("aao_supabase_key", key);
  showToast("✅ Configurazione salvata!");
}

// ============================================================
// KEYBOARD CONTROLS (desktop)
// ============================================================
function setupKeyboard() {
  document.addEventListener("keydown", e => {
    const screen = document.querySelector(".screen.active")?.id;
    if (screen === "screen-game") {
      if (e.key === "ArrowUp"    || e.key === "w") { e.preventDefault(); movePlayer("up"); }
      if (e.key === "ArrowDown"  || e.key === "s") { e.preventDefault(); movePlayer("down"); }
      if (e.key === "ArrowLeft"  || e.key === "a") { e.preventDefault(); movePlayer("left"); }
      if (e.key === "ArrowRight" || e.key === "d") { e.preventDefault(); movePlayer("right"); }
      if (e.key === "z" || e.key === "Enter") actionA();
      if (e.key === "x" || e.key === "Escape") actionB();
    }
    if (screen === "screen-battle") {
      if (e.key === "Escape") showMainMenu();
    }
  });
}

// ============================================================
// BATTLE LOG DISPLAY
// ============================================================
function setBattleLog(text) {
  const el = document.getElementById("battle-log-text");
  if (el) el.textContent = text;
}

function showBattleLog(lines, cb) {
  let i = 0;
  const show = () => {
    if (i < lines.length) {
      setBattleLog(lines[i++]);
      setTimeout(show, 1200);
    } else {
      cb && cb();
    }
  };
  show();
}

// ============================================================
// HP / XP BARS
// ============================================================
function setHPBar(id, cur, max) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = Math.max(0, Math.min(100, (cur / max) * 100));
  el.style.width = pct + "%";
  el.classList.remove("yellow", "red");
  if (pct <= 20) el.classList.add("red");
  else if (pct <= 50) el.classList.add("yellow");
}

function setXPBar(id, xp, xpNext) {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = Math.max(0, Math.min(100, (xp / xpNext) * 100));
  el.style.width = pct + "%";
}

// ============================================================
// UTILS
// ============================================================
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function show(id) { const el = document.getElementById(id); if (el) el.style.display = ""; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = "none"; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function getTypeEmoji(type) {
  const map = {
    ELECTRIC:"⚡", GRASS:"🌿", WATER:"🌊", FIRE:"🔥",
    FLYING:"💨", STEEL:"⚙️", GHOST:"👻", DARK:"🌑",
    PSYCHIC:"🔮", NORMAL:"⬜", ROCK:"🪨", GROUND:"🌍",
    ICE:"❄️", BUG:"🐛", POISON:"☠️", DRAGON:"🐉", FAIRY:"✨", FIGHTING:"👊"
  };
  return map[type] || "❓";
}

function showToast(msg, duration = 2500) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = "block";
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = "none"; }, duration);
}

function showFormStatus(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `form-status ${type === "error" ? "error" : ""}`;
  el.style.display = "block";
}
