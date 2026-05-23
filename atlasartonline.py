"""
atlasartonline.py
=================
AAO - Atlas Art Online
First open-source game in the Atlas Valley ecosystem.
Style: Pokemon GBA + Sword Art Online narrative + Atlas Valley future-city world.
Characters: panthera_leo & elf_wizard
Backend: FastAPI + Supabase (PostgreSQL)

Run: uvicorn atlasartonline:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json, os, random, math, time, uuid, httpx
from datetime import datetime

# ============================================================
# CONFIG — Supabase credentials (fill in your own)
# ============================================================
SUPABASE_URL = os.getenv("SUPABASE_URL", "YOUR_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "YOUR_SUPABASE_ANON_KEY")

# ============================================================
# Load game data from addons/
# ============================================================
BASE = os.path.dirname(os.path.abspath(__file__))
ADDONS = os.path.join(BASE, "addons")

def load_json(filename):
    with open(os.path.join(ADDONS, filename), encoding="utf-8") as f:
        return json.load(f)

CREATURES   = load_json("creatures.json")
WORLD       = load_json("world.json")
MOVES       = {m["name"]: m for m in load_json("moves.json")}
TYPE_CHART  = load_json("type_chart.json")
ITEMS       = load_json("items.json")
SAVE_TMPL   = load_json("save_template.json")

# ============================================================
# FastAPI App
# ============================================================
app = FastAPI(
    title="AAO — Atlas Art Online API",
    description="The first open-source Pokemon-style game in the Atlas Valley ecosystem.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static frontend files
app.mount("/static", StaticFiles(directory=BASE), name="static")

# ============================================================
# Supabase client helper
# ============================================================
async def supabase_request(method: str, endpoint: str, data: dict = None, params: dict = None):
    """Generic Supabase REST API call."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    async with httpx.AsyncClient() as client:
        if method == "GET":
            r = await client.get(url, headers=headers, params=params)
        elif method == "POST":
            r = await client.post(url, headers=headers, json=data)
        elif method == "PATCH":
            r = await client.patch(url, headers=headers, json=data, params=params)
        elif method == "DELETE":
            r = await client.delete(url, headers=headers, params=params)
        else:
            raise ValueError(f"Unknown method: {method}")
    return r.json() if r.text else {}

# ============================================================
# Pydantic Models
# ============================================================
class NewGameRequest(BaseModel):
    player_name: str
    character: str = "panthera_leo"  # or "elf_wizard"
    starter_creature: str  # "VOLTCUB", "SOLARSEED", or "AQUADRON"

class SaveGameRequest(BaseModel):
    player_id: str
    save_data: Dict[str, Any]

class BattleActionRequest(BaseModel):
    session_id: str
    action: str  # "fight", "bag", "switch", "run"
    move_name: Optional[str] = None
    item_name: Optional[str] = None
    switch_index: Optional[int] = None

class CaptureRequest(BaseModel):
    session_id: str
    ball_type: str = "AEONball"

class MoveRequest(BaseModel):
    player_id: str
    map_id: str
    x: int
    y: int

# ============================================================
# In-memory battle sessions (production: use Redis/DB)
# ============================================================
battle_sessions: Dict[str, Dict] = {}

# ============================================================
# GAME DATA ENDPOINTS
# ============================================================

@app.get("/")
async def root():
    return FileResponse(os.path.join(BASE, "index.html"))

@app.get("/api/creatures")
async def get_all_creatures():
    """Get full creature dex."""
    return CREATURES

@app.get("/api/creatures/{creature_id}")
async def get_creature(creature_id: str):
    creature_id = creature_id.upper()
    if creature_id not in CREATURES:
        raise HTTPException(404, f"Creature {creature_id} not found")
    return CREATURES[creature_id]

@app.get("/api/world")
async def get_world():
    """Get full world map."""
    return WORLD

@app.get("/api/world/{map_id}")
async def get_map(map_id: str):
    if map_id not in WORLD:
        raise HTTPException(404, f"Map {map_id} not found")
    return WORLD[map_id]

@app.get("/api/moves")
async def get_moves():
    return list(MOVES.values())

@app.get("/api/items")
async def get_items():
    return ITEMS

@app.get("/api/starters")
async def get_starters():
    return {
        "VOLTCUB": {**CREATURES["VOLTCUB"], "starter_desc": "Quick and electric. Ideal for fast players."},
        "SOLARSEED": {**CREATURES["SOLARSEED"], "starter_desc": "Balanced and defensive. Great for strategists."},
        "AQUADRON": {**CREATURES["AQUADRON"], "starter_desc": "Durable water-type. Good for beginners."}
    }

# ============================================================
# PLAYER MANAGEMENT
# ============================================================

@app.post("/api/game/new")
async def new_game(req: NewGameRequest):
    """Create a new game save."""
    player_id = str(uuid.uuid4())
    import copy
    save = copy.deepcopy(SAVE_TMPL)
    save["player"]["name"] = req.player_name
    save["player"]["character"] = req.character
    save["player"]["id"] = player_id

    # Build starter AEON at level 5
    starter = build_aeon(req.starter_creature, 5)
    if not starter:
        raise HTTPException(400, f"Invalid starter: {req.starter_creature}")
    save["team"] = [starter]
    save["flags"]["received_starter"] = True
    save["codex"][req.starter_creature] = True
    save["created_at"] = datetime.utcnow().isoformat()

    # Save to Supabase
    try:
        await supabase_request("POST", "players", {
            "id": player_id,
            "name": req.player_name,
            "character": req.character,
            "save_data": json.dumps(save),
            "created_at": save["created_at"]
        })
    except Exception as e:
        print(f"Supabase error (non-fatal): {e}")

    return {"player_id": player_id, "save": save}

@app.get("/api/game/load/{player_id}")
async def load_game(player_id: str):
    """Load a player's save from Supabase."""
    try:
        result = await supabase_request("GET", "players", params={
            "id": f"eq.{player_id}",
            "select": "*"
        })
        if not result:
            raise HTTPException(404, "Save not found")
        player = result[0]
        save_data = json.loads(player["save_data"]) if isinstance(player["save_data"], str) else player["save_data"]
        return {"player_id": player_id, "save": save_data}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.post("/api/game/save")
async def save_game(req: SaveGameRequest):
    """Persist a save to Supabase."""
    try:
        await supabase_request("PATCH", "players",
            data={"save_data": json.dumps(req.save_data)},
            params={"id": f"eq.{req.player_id}"}
        )
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/api/leaderboard")
async def get_leaderboard():
    """Top 10 players by battles won."""
    try:
        result = await supabase_request("GET", "players", params={
            "select": "name,character,badges_count,battles_won",
            "order": "battles_won.desc",
            "limit": "10"
        })
        return result
    except:
        return []

# ============================================================
# MOVEMENT & EXPLORATION
# ============================================================

@app.post("/api/world/move")
async def move_player(req: MoveRequest):
    """
    Process player movement. Returns:
    - map state
    - any wild encounter
    - any NPC at location
    - any item at location
    """
    if req.map_id not in WORLD:
        raise HTTPException(404, f"Map {req.map_id} not found")

    map_data = WORLD[req.map_id]
    response = {
        "map": req.map_id,
        "x": req.x,
        "y": req.y,
        "encounter": None,
        "npc": None,
        "item": None,
        "event": None
    }

    # Check NPC collision
    for npc in map_data.get("npcs", []):
        pos = npc.get("position", {})
        if pos.get("x") == req.x and pos.get("y") == req.y:
            response["npc"] = npc
            return response

    # Check item pickup
    for item in map_data.get("items", []):
        if item.get("x") == req.x and item.get("y") == req.y:
            response["item"] = item
            return response

    # Wild encounter check
    wild = map_data.get("wild_encounters", [])
    if wild and random.random() < 0.12:  # 12% chance per step in grass
        encounter = weighted_creature_pick(wild)
        if encounter:
            creature_data = CREATURES.get(encounter["creature"])
            if creature_data:
                level = random.randint(encounter["level_min"], encounter["level_max"])
                wild_aeon = build_aeon(encounter["creature"], level)
                response["encounter"] = wild_aeon

    return response

# ============================================================
# BATTLE SYSTEM
# ============================================================

@app.post("/api/battle/start/wild")
async def start_wild_battle(session_id: str, player_team: List[Dict], wild_aeon: Dict):
    """Initialize a wild AEON battle session."""
    session = {
        "id": session_id,
        "type": "wild",
        "turn": 0,
        "player_team": player_team,
        "active_player_idx": 0,
        "enemy": wild_aeon,
        "enemy_captured": False,
        "fled": False,
        "result": None,
        "log": [f"A wild {wild_aeon['name']} appeared!"]
    }
    battle_sessions[session_id] = session
    return session

@app.post("/api/battle/start/trainer")
async def start_trainer_battle(session_id: str, player_team: List[Dict], trainer: Dict):
    """Initialize a trainer battle session."""
    trainer_team = [build_aeon(t["creature"], t["level"]) for t in trainer.get("team", [])]
    session = {
        "id": session_id,
        "type": "trainer",
        "trainer_name": trainer.get("name", "Trainer"),
        "turn": 0,
        "player_team": player_team,
        "active_player_idx": 0,
        "enemy_team": trainer_team,
        "active_enemy_idx": 0,
        "result": None,
        "log": [f"{trainer.get('name', 'Trainer')} wants to battle!",
                f"{trainer.get('name', 'Trainer')} sent out {trainer_team[0]['name']}!"]
    }
    battle_sessions[session_id] = session
    return session

@app.post("/api/battle/action")
async def battle_action(req: BattleActionRequest):
    """Process a battle action (fight/bag/switch/run)."""
    session = battle_sessions.get(req.session_id)
    if not session:
        raise HTTPException(404, "Battle session not found")

    log = []
    player = session["player_team"][session["active_player_idx"]]

    if session["type"] == "wild":
        enemy = session["enemy"]
    else:
        enemy = session["enemy_team"][session["active_enemy_idx"]]

    if req.action == "fight":
        if not req.move_name:
            raise HTTPException(400, "move_name required for fight action")
        move = MOVES.get(req.move_name)
        if not move:
            raise HTTPException(400, f"Move {req.move_name} not found")

        # Player attacks first if higher speed (simplified)
        player_first = player["stats"]["spe"] >= enemy["stats"]["spe"]

        if player_first:
            dmg, msg = calculate_damage(player, enemy, move)
            enemy["current_hp"] = max(0, enemy["current_hp"] - dmg)
            log.append(msg)
            if enemy["current_hp"] > 0:
                ai_msg = ai_attack(enemy, player, session)
                log.extend(ai_msg)
        else:
            ai_msg = ai_attack(enemy, player, session)
            log.extend(ai_msg)
            if player["current_hp"] > 0:
                dmg, msg = calculate_damage(player, enemy, move)
                enemy["current_hp"] = max(0, enemy["current_hp"] - dmg)
                log.append(msg)

    elif req.action == "bag" and req.item_name:
        log.append(f"Used {req.item_name}.")
        item = ITEMS.get(req.item_name)
        if item:
            if item["effect"] == "heal":
                heal_amt = item["value"]
                old_hp = player["current_hp"]
                player["current_hp"] = min(player["stats"]["hp"], player["current_hp"] + heal_amt)
                actual = player["current_hp"] - old_hp
                log.append(f"{player['name']} restored {actual} HP!")
            elif item["effect"] == "capture" and session["type"] == "wild":
                success, msg = attempt_capture(enemy, item.get("value", 1.0))
                log.append(msg)
                if success:
                    session["enemy_captured"] = True
                    session["result"] = "captured"
                    session["log"].extend(log)
                    return session

        # AI still attacks after item use
        if enemy["current_hp"] > 0 and player["current_hp"] > 0:
            ai_msg = ai_attack(enemy, player, session)
            log.extend(ai_msg)

    elif req.action == "run":
        if session["type"] == "wild":
            run_chance = 0.65
            if random.random() < run_chance:
                session["fled"] = True
                session["result"] = "fled"
                log.append("Got away safely!")
            else:
                log.append("Couldn't escape!")
                ai_msg = ai_attack(enemy, player, session)
                log.extend(ai_msg)
        else:
            log.append("Can't flee from a trainer battle!")

    elif req.action == "switch" and req.switch_index is not None:
        new_idx = req.switch_index
        if 0 <= new_idx < len(session["player_team"]):
            session["active_player_idx"] = new_idx
            new_aeon = session["player_team"][new_idx]
            log.append(f"Go, {new_aeon['name']}!")
            if enemy["current_hp"] > 0:
                ai_msg = ai_attack(enemy, new_aeon, session)
                log.extend(ai_msg)

    # Check win/loss conditions
    session = check_battle_end(session, log)
    session["log"].extend(log)
    session["turn"] += 1

    return session

# ============================================================
# BATTLE HELPERS
# ============================================================

def calculate_damage(attacker: Dict, defender: Dict, move: Dict) -> tuple:
    """Gen 6 damage formula approximation."""
    if move["power"] == 0 or move["damage_class"] == "status":
        return 0, f"{attacker['name']} used {move['name'].replace('-', ' ').title()}!"

    level = attacker.get("level", 5)
    move_type = move.get("type", "NORMAL").upper()
    damage_class = move.get("damage_class", "special")

    if damage_class == "physical":
        atk = attacker["stats"]["atk"]
        def_ = defender["stats"]["def"]
    else:
        atk = attacker["stats"]["spa"]
        def_ = defender["stats"]["spd"]

    power = move["power"]

    # Base damage
    damage = math.floor(((2 * level / 5 + 2) * power * atk / def_) / 50 + 2)

    # STAB
    if move_type == attacker.get("type", "NORMAL"):
        damage = math.floor(damage * 1.5)

    # Type effectiveness
    effectiveness = get_type_effectiveness(move_type, defender.get("type", "NORMAL"))
    damage = math.floor(damage * effectiveness)

    # Random factor
    damage = math.floor(damage * random.uniform(0.85, 1.0))
    damage = max(1, damage)

    # Build message
    eff_text = ""
    if effectiveness >= 2: eff_text = " It's super effective!"
    elif effectiveness == 0: eff_text = " It had no effect."
    elif effectiveness < 1: eff_text = " It's not very effective..."

    # Drain / recoil
    extra = ""
    drain = move.get("drain", 0)
    if drain > 0:
        restore = math.floor(damage * drain / 100)
        attacker["current_hp"] = min(attacker["stats"]["hp"], attacker["current_hp"] + restore)
        extra = f" {attacker['name']} restored {restore} HP!"
    elif drain < 0:
        recoil = math.floor(damage * abs(drain) / 100)
        attacker["current_hp"] = max(0, attacker["current_hp"] - recoil)
        extra = f" {attacker['name']} took {recoil} recoil damage!"

    msg = f"{attacker['name']} used {move['name'].replace('-', ' ').title()}! {defender['name']} took {damage} damage!{eff_text}{extra}"
    return damage, msg

def get_type_effectiveness(attack_type: str, defend_type: str) -> float:
    chart = TYPE_CHART.get(attack_type, {})
    return chart.get(defend_type, 1.0)

def ai_attack(enemy: Dict, player: Dict, session: Dict) -> List[str]:
    """Simple AI: pick a random move."""
    moves = enemy.get("moves", [])
    if not moves:
        return [f"{enemy['name']} is confused!"]
    move_name = random.choice(moves)
    move = MOVES.get(move_name, {"name": move_name, "power": 40, "accuracy": 100, "damage_class": "physical", "type": "NORMAL"})
    dmg, msg = calculate_damage(enemy, player, move)
    player["current_hp"] = max(0, player["current_hp"] - dmg)
    return [msg]

def attempt_capture(wild_aeon: Dict, ball_modifier: float = 1.0) -> tuple:
    """Simplified capture formula."""
    max_hp = wild_aeon["stats"]["hp"]
    cur_hp = wild_aeon["current_hp"]
    catch_rate = wild_aeon.get("catch_rate", 45)
    a = ((3 * max_hp - 2 * cur_hp) * catch_rate * ball_modifier) / (3 * max_hp)
    threshold = a / 255
    success = random.random() < threshold
    if success:
        return True, f"{wild_aeon['name']} was captured! Welcome to the team!"
    else:
        shake_count = random.randint(1, 3)
        return False, f"Almost! {wild_aeon['name']} broke free! ({shake_count} shake{'s' if shake_count != 1 else ''})"

def check_battle_end(session: Dict, log: List[str]) -> Dict:
    if session.get("result"):
        return session

    player_team = session["player_team"]
    active_player = player_team[session["active_player_idx"]]
    enemy = session.get("enemy") if session["type"] == "wild" else session["enemy_team"][session["active_enemy_idx"]]

    if enemy["current_hp"] <= 0:
        log.append(f"{enemy['name']} fainted!")
        # Award XP
        xp = math.floor(enemy["stats"]["hp"] * enemy["level"] * 0.5)
        active_player["xp"] = active_player.get("xp", 0) + xp
        log.append(f"{active_player['name']} gained {xp} XP!")

        if session["type"] == "trainer":
            remaining = [t for i, t in enumerate(session["enemy_team"]) if i > session["active_enemy_idx"] and t["current_hp"] > 0]
            if remaining:
                session["active_enemy_idx"] += 1
                next_e = session["enemy_team"][session["active_enemy_idx"]]
                log.append(f"{session['trainer_name']} sent out {next_e['name']}!")
            else:
                session["result"] = "win"
                log.append(f"You defeated {session['trainer_name']}!")
        else:
            session["result"] = "win"

    if active_player["current_hp"] <= 0:
        log.append(f"{active_player['name']} fainted!")
        next_alive = next((i for i, p in enumerate(player_team) if i != session["active_player_idx"] and p["current_hp"] > 0), None)
        if next_alive is not None:
            session["active_player_idx"] = next_alive
            log.append(f"Go, {player_team[next_alive]['name']}!")
        else:
            session["result"] = "lose"
            log.append("All your AEONs fainted! You blacked out...")

    return session

# ============================================================
# AEON BUILDER
# ============================================================

def build_aeon(creature_id: str, level: int) -> Optional[Dict]:
    """Build a battle-ready AEON dict from base data."""
    base = CREATURES.get(creature_id.upper())
    if not base:
        return None

    # Scale stats
    def calc_stat(base_stat, level, is_hp=False):
        if is_hp:
            return math.floor((2 * base_stat * level) / 100) + level + 10
        return math.floor((2 * base_stat * level) / 100) + 5

    hp = calc_stat(base["hp"], level, is_hp=True)
    stats = {
        "hp": hp,
        "atk": calc_stat(base["atk"], level),
        "def": calc_stat(base["def"], level),
        "spa": calc_stat(base["spa"], level),
        "spd": calc_stat(base["spd"], level),
        "spe": calc_stat(base["spe"], level),
    }

    # Get moves for this level
    learnable = [m["name"] for m in base.get("moves", []) if m["level"] <= level]
    moves = learnable[-4:] if learnable else ["tackle"]

    return {
        "id": f"{creature_id}_{uuid.uuid4().hex[:8]}",
        "creature_id": creature_id.upper(),
        "name": base["name"],
        "type": base["type"],
        "level": level,
        "xp": 0,
        "xp_next": int(level ** 3),
        "current_hp": hp,
        "stats": stats,
        "moves": moves,
        "status": None,  # burn, poison, paralysis, sleep, freeze
        "catch_rate": base.get("catch", 45),
        "sprite": base.get("sprite", "?"),
        "color": base.get("color", "#FFFFFF"),
        "legendary": base.get("legendary", False)
    }

# ============================================================
# SQL / SUPABASE SCHEMA ENDPOINTS
# ============================================================

@app.get("/api/sql/schema")
async def get_schema():
    """Return the SQL schema for Supabase setup."""
    schema = get_supabase_schema()
    return {"schema": schema}

@app.post("/api/sql/init")
async def init_database():
    """
    Returns SQL commands to run in Supabase SQL editor.
    (Actual execution must be done in Supabase dashboard or via service_role key)
    """
    return {
        "instructions": [
            "1. Go to your Supabase dashboard",
            "2. Open the SQL Editor",
            "3. Run the schema from /api/sql/schema",
            "4. Set your SUPABASE_URL and SUPABASE_KEY env variables",
            "5. Restart the server"
        ],
        "schema": get_supabase_schema()
    }

def get_supabase_schema() -> str:
    return """
-- ============================================================
-- AAO (Atlas Art Online) — Supabase PostgreSQL Schema
-- Organization: pantheraleo-atlasvalley-AAO
-- Project: AAO
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- PLAYERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    character TEXT DEFAULT 'panthera_leo',
    save_data JSONB NOT NULL DEFAULT '{}',
    badges_count INT DEFAULT 0,
    battles_won INT DEFAULT 0,
    battles_lost INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

-- Policy: players can only read/write their own data
CREATE POLICY "Players can read own data"
    ON players FOR SELECT
    USING (auth.uid()::text = id::text);

CREATE POLICY "Players can insert own data"
    ON players FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Players can update own data"
    ON players FOR UPDATE
    USING (auth.uid()::text = id::text);

-- ============================================================
-- CODEX TABLE — AEON captures per player
-- ============================================================
CREATE TABLE IF NOT EXISTS codex (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    creature_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    seen BOOLEAN DEFAULT true,
    caught BOOLEAN DEFAULT false,
    UNIQUE(player_id, creature_id)
);

ALTER TABLE codex ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Codex readable by owner"
    ON codex FOR SELECT
    USING (player_id IN (SELECT id FROM players WHERE id::text = auth.uid()::text));

CREATE POLICY "Codex insertable by owner"
    ON codex FOR INSERT
    WITH CHECK (true);

-- ============================================================
-- LEADERBOARD VIEW
-- ============================================================
CREATE OR REPLACE VIEW leaderboard AS
    SELECT
        name,
        character,
        battles_won,
        battles_lost,
        badges_count,
        created_at
    FROM players
    ORDER BY battles_won DESC, badges_count DESC
    LIMIT 100;

-- ============================================================
-- BATTLE_LOG TABLE — record all battles
-- ============================================================
CREATE TABLE IF NOT EXISTS battle_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    player_id UUID REFERENCES players(id) ON DELETE CASCADE,
    battle_type TEXT NOT NULL, -- 'wild', 'trainer', 'gym', 'council'
    opponent_name TEXT,
    result TEXT NOT NULL, -- 'win', 'lose', 'fled', 'captured'
    turns INT DEFAULT 0,
    map_id TEXT,
    credits_earned INT DEFAULT 0,
    played_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE battle_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Battle log readable by owner"
    ON battle_log FOR SELECT
    USING (player_id IN (SELECT id FROM players WHERE id::text = auth.uid()::text));

CREATE POLICY "Battle log insertable by owner"
    ON battle_log FOR INSERT
    WITH CHECK (true);

-- ============================================================
-- FUNCTION: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER players_updated_at
    BEFORE UPDATE ON players
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- INDEXES for performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_players_battles_won ON players(battles_won DESC);
CREATE INDEX IF NOT EXISTS idx_codex_player ON codex(player_id);
CREATE INDEX IF NOT EXISTS idx_battle_log_player ON battle_log(player_id);
"""

# ============================================================
# STATS ENDPOINT
# ============================================================

@app.get("/api/stats")
async def get_stats():
    try:
        players = await supabase_request("GET", "players", params={"select": "count"})
        return {
            "total_players": len(players) if isinstance(players, list) else 0,
            "total_creatures": len(CREATURES),
            "total_maps": len(WORLD),
            "version": "1.0.0"
        }
    except:
        return {"total_creatures": len(CREATURES), "total_maps": len(WORLD), "version": "1.0.0"}

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    import uvicorn
    print("⚡ AAO — Atlas Art Online Server")
    print("   Starting on http://localhost:8000")
    print("   API docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
