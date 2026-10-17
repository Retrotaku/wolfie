from __future__ import annotations

import os
import secrets
import string
import threading
import time
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request, send_from_directory, session

MIN_PLAYERS = 6
MAX_PLAYERS = 14
ROOM_CODE_LENGTH = 6
ROOM_CODE_CHARACTERS = string.ascii_uppercase + string.digits
PRESENCE_TIMEOUT_SECONDS = 10
MAIN_SPECIAL_ROLES = {"voyante", "sorciere", "cupidon", "chasseur"}
MAIN_WOLF_VARIANTS = {"loup_enrage", "loup_blanc"}
MAIN_ROLE_IDS = {
    "voyante",
    "sorciere",
    "cupidon",
    "chasseur",
    "loup_garou",
    "loup_enrage",
    "loup_blanc",
    "villageois",
}
PREMIUM_ROLE_IDS = {
    "assassin",
    "aveugle",
    "bouffon",
    "bourreau",
    "chaperon_rouge",
    "corbeau",
    "fossoyeur",
    "inquisiteur",
    "petite_fille",
    "prete",
    "traitre",
    "vampire",
    "voleur",
}
SPECIAL_ROLES = MAIN_SPECIAL_ROLES
WOLF_VARIANTS = MAIN_WOLF_VARIANTS
ROLE_CARDS = {
    "voyante": ("Voyante", "Voyante.jpeg", "Ton regard perce les secrets de la nuit."),
    "sorciere": ("Sorcière", "Sorciere.jpeg", "Tu possèdes une potion de vie et une potion de mort, chacune utilisable une fois. Tu connais la victime de la meute, peux te sauver et utiliser les deux potions la même nuit."),
    "cupidon": ("Cupidon", "Cupidon.jpeg", "La première nuit, lie deux joueurs. Si l’un meurt, l’autre meurt aussi. Si les amoureux sont de camps différents, ils gagnent ensemble s’ils sont les deux derniers survivants."),
    "chasseur": ("Chasseur", "Chasseur.jpeg", "À ta mort, quelle qu’en soit la cause, tu peux éliminer un joueur vivant."),
    "loup_garou": ("Loup-Garou", "Loup_Garou.jpeg", "Chaque nuit, vote avec la meute pour éliminer un joueur. La meute gagne quand seuls des Loups-Garous et des Loups Enragés restent en vie."),
    "loup_enrage": ("Loup Enragé", "Loup_Enrage.jpeg", "Tu votes avec la meute chaque nuit. Une seule fois dans la partie, tu peux convertir un joueur vivant en Loup-Garou ordinaire. Il perd son ancien rôle et ses pouvoirs."),
    "loup_blanc": ("Loup Blanc", "Loup_Blanc.jpeg", "Tu es indépendant. À partir de la nuit 2, une nuit sur deux, tu peux éliminer un joueur de ton choix. Tu gagnes seul, ou avec ton amoureux si vous êtes les deux derniers survivants."),
    "villageois": ("Villageois", "Villageois.jpeg", "Aucun pouvoir spécial. Le village gagne quand aucun Loup-Garou, Loup Enragé ou Loup Blanc ne reste en vie."),
    "assassin": ("Assassin", "Assassin.jpeg", "Rôle premium : élimine un adversaire selon la stratégie de ta partie."),
    "aveugle": ("Aveugle", "Aveugle.jpeg", "Rôle premium : tu marches dans l’ombre et tu ne vois pas les dangers autour de toi."),
    "bouffon": ("Bouffon", "Bouffon.jpeg", "Rôle premium : tu perturbes le village avec une présence déroutante."),
    "bourreau": ("Bourreau", "Bourreau.jpeg", "Rôle premium : la mort sert tes intérêts."),
    "chaperon_rouge": ("Chaperon Rouge", "Chaperon_Rouge.jpeg", "Rôle premium : tu portes un message ou une protection à celui que tu veux sauver."),
    "corbeau": ("Corbeau", "Corbeau.jpeg", "Rôle premium : tu observes le village et rapportes ce que tu vois."),
    "fossoyeur": ("Fossoyeur", "Fossoyeur.jpeg", "Rôle premium : tu manipules les morts et les secrets du cimetière."),
    "inquisiteur": ("Inquisiteur", "Inquisiteur.jpeg", "Rôle premium : tu traques les hérétiques et les dangers cachés."),
    "petite_fille": ("Petite Fille", "Petite_Fille.jpeg", "Rôle premium : tu guette la nuit en espérant surprendre les loups."),
    "prete": ("Prête", "Prête.jpeg", "Rôle premium : ta sagesse et ta présence influencent le village."),
    "traitre": ("Traître", "Traître.jpeg", "Rôle premium : tu joues double jeu et tes alliances peuvent changer."),
    "vampire": ("Vampire", "Vampire.jpeg", "Rôle premium : tu vis parmi les ténèbres et graves ton emprise sur le village."),
    "voleur": ("Voleur", "Voleur.jpeg", "Rôle premium : tu prends ce qui ne t’appartient pas."),
}
DEFAULT_SPECIAL_ROLES = {
    (6, 8): ["voyante", "sorciere"],
    (9, 11): ["voyante", "sorciere", "cupidon"],
    (12, 14): ["voyante", "sorciere", "cupidon", "chasseur"],
}


def is_premium_role(role_id: str) -> bool:
    return role_id in PREMIUM_ROLE_IDS

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("WOLFIE_SECRET_KEY", os.urandom(32))
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
app.config["PREFERRED_URL_SCHEME"] = os.environ.get("PREFERRED_URL_SCHEME", "http")

rooms: dict[str, dict[str, Any]] = {}
rooms_lock = threading.Lock()


def clean_name(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("Entre un prénom ou un pseudonyme.")
    name = " ".join(value.split())
    if not name or len(name) > 24:
        raise ValueError("Le nom doit contenir entre 1 et 24 caractères.")
    return name


def default_composition(player_count: int) -> dict[str, list[str]] | None:
    if player_count < MIN_PLAYERS or player_count > MAX_PLAYERS:
        return None

    special_roles = next(
        roles for (lower, upper), roles in DEFAULT_SPECIAL_ROLES.items()
        if lower <= player_count <= upper
    )
    wolf_roles = []
    if player_count >= 9:
        wolf_roles.append("loup_enrage")
    if player_count >= 12:
        wolf_roles.append("loup_blanc")
    return {"special_roles": special_roles.copy(), "wolf_roles": wolf_roles}


def composition_counts(player_count: int, composition: dict[str, list[str]]) -> dict[str, Any]:
    special_count = len(composition["special_roles"])
    wolf_count = (player_count - special_count) // 2
    villager_count = player_count - special_count - wolf_count
    return {
        "special_roles": composition["special_roles"],
        "wolf_roles": composition["wolf_roles"],
        "wolf_count": wolf_count,
        "villager_count": villager_count,
        "special_count": special_count,
    }


def validate_composition(value: Any, player_count: int) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        raise ValueError("La composition des rôles n’est pas valide.")

    special_roles = value.get("special_roles")
    wolf_roles = value.get("wolf_roles")
    if (
        not isinstance(special_roles, list)
        or any(not isinstance(role, str) for role in special_roles)
        or len(set(special_roles)) != len(special_roles)
        or not set(special_roles).issubset(SPECIAL_ROLES)
        or any(is_premium_role(role) for role in special_roles)
    ):
        raise ValueError("Les rôles spéciaux doivent être uniques, disponibles et appartenir aux personnages principaux.")
    if (
        not isinstance(wolf_roles, list)
        or any(not isinstance(role, str) for role in wolf_roles)
        or len(set(wolf_roles)) != len(wolf_roles)
        or not set(wolf_roles).issubset(WOLF_VARIANTS)
    ):
        raise ValueError("Les variantes de loups doivent être uniques et disponibles.")

    composition = {
        "special_roles": special_roles.copy(),
        "wolf_roles": wolf_roles.copy(),
    }
    counts = composition_counts(player_count, composition)
    if counts["wolf_count"] < 1:
        raise ValueError("La composition doit contenir au moins un Loup-Garou.")
    if len(wolf_roles) > counts["wolf_count"]:
        raise ValueError("Il n’y a pas assez de places dans la meute pour ces variantes.")
    return composition


def create_room(mode: str, names: list[str]) -> dict[str, Any]:
    if mode not in {"local", "online"}:
        raise ValueError("Mode de jeu inconnu.")

    cleaned_names = [clean_name(name) for name in names]
    if mode == "local" and not MIN_PLAYERS <= len(cleaned_names) <= MAX_PLAYERS:
        raise ValueError(f"Une partie locale doit compter entre {MIN_PLAYERS} et {MAX_PLAYERS} joueurs.")
    if not cleaned_names:
        raise ValueError("Ajoute au moins un joueur.")
    if len({name.casefold() for name in cleaned_names}) != len(cleaned_names):
        raise ValueError("Chaque joueur doit avoir un nom différent.")

    with rooms_lock:
        while True:
            code = "".join(secrets.choice(ROOM_CODE_CHARACTERS) for _ in range(ROOM_CODE_LENGTH))
            if code not in rooms:
                break

        host_id = secrets.token_urlsafe(16)
        now = time.monotonic()
        players = [
            {
                "id": host_id if index == 0 else secrets.token_urlsafe(16),
                "name": name,
                "ready": False,
                "last_seen": now,
            }
            for index, name in enumerate(cleaned_names)
        ]
        room = {
            "code": code,
            "mode": mode,
            "host_id": host_id,
            "players": players,
            "local_named_indices": set(),
            "local_role_viewed_indices": set(),
            "composition": default_composition(len(players)),
            "composition_customized": False,
            "started": False,
            "game": None,
        }
        rooms[code] = room
    return room


PACK_ROLES = {"loup_garou", "loup_enrage"}
WOLF_ROLES = PACK_ROLES | {"loup_blanc"}


def initialize_game(room: dict[str, Any], *, dealing: bool = False) -> None:
    for player in room["players"]:
        player["alive"] = True
    room["game"] = {
        "phase": "dealing" if dealing else "night",
        "round": 1,
        "actions": [],
        "action_index": 0,
        "pack_votes": [],
        "pack_target": None,
        "white_wolf_target": None,
        "witch_save": False,
        "witch_kill_target": None,
        "enraged_target": None,
        "enraged_used": False,
        "witch_life_used": False,
        "witch_death_used": False,
        "lovers": None,
        "deaths": [],
        "votes": {},
        "winners": [],
        "message": "La première nuit commence.",
        "private_results": {},
        "after_hunters": "day",
    }
    if not dealing:
        prepare_night(room)


def current_action(room: dict[str, Any]) -> dict[str, Any] | None:
    game = room["game"]
    actions = game["actions"]
    index = game["action_index"]
    return actions[index] if index < len(actions) else None


def prepare_night(room: dict[str, Any]) -> None:
    game = room["game"]
    game.update(
        phase="night",
        actions=[],
        action_index=0,
        pack_votes=[],
        pack_target=None,
        white_wolf_target=None,
        witch_save=False,
        witch_kill_target=None,
        enraged_target=None,
        votes={},
        private_results={},
        after_hunters="day",
    )
    players = room["players"]
    alive_indices = [
        index for index, player in enumerate(players) if player.get("alive", True)
    ]
    actions: list[dict[str, Any]] = []

    if game["round"] == 1:
        actions.extend(
            {"actor_index": index, "kind": "cupidon"}
            for index in alive_indices
            if players[index]["role"] == "cupidon" and game["lovers"] is None
        )
    actions.extend(
        {"actor_index": index, "kind": "wolf_vote"}
        for index in alive_indices
        if players[index]["role"] in PACK_ROLES
    )
    if not game["enraged_used"]:
        actions.extend(
            {"actor_index": index, "kind": "enrage"}
            for index in alive_indices
            if players[index]["role"] == "loup_enrage"
        )
    if game["round"] >= 2 and game["round"] % 2 == 0:
        actions.extend(
            {"actor_index": index, "kind": "white_wolf"}
            for index in alive_indices
            if players[index]["role"] == "loup_blanc"
        )
    if not (game["witch_life_used"] and game["witch_death_used"]):
        actions.extend(
            {"actor_index": index, "kind": "witch"}
            for index in alive_indices
            if players[index]["role"] == "sorciere"
        )
    actions.extend(
        {"actor_index": index, "kind": "seer"}
        for index in alive_indices
        if players[index]["role"] == "voyante"
    )
    game["actions"] = actions


def add_deaths(room: dict[str, Any], targets: list[int], cause: str) -> None:
    game = room["game"]
    players = room["players"]
    pending = list(dict.fromkeys(targets))
    added_hunters: set[int] = set()
    while pending:
        index = pending.pop(0)
        if not 0 <= index < len(players) or not players[index].get("alive", True):
            continue
        player = players[index]
        player["alive"] = False
        game["deaths"].append({"name": player["name"], "cause": cause})
        if player["role"] == "chasseur" and index not in added_hunters:
            added_hunters.add(index)
            game["actions"].append({"actor_index": index, "kind": "hunter"})
        lovers = game["lovers"]
        if lovers and index in lovers:
            partner = lovers[1] if lovers[0] == index else lovers[0]
            if players[partner].get("alive", True):
                pending.append(partner)


def check_winners(room: dict[str, Any]) -> list[str]:
    players = room["players"]
    game = room["game"]
    alive = [player for player in players if player.get("alive", True)]
    alive_roles = {player["role"] for player in alive}
    winners = []
    if not alive_roles.intersection(WOLF_ROLES | {"vampire"}):
        winners.append("village")
    if alive and all(player["role"] in PACK_ROLES for player in alive):
        winners.append("meute")
    white_wolf = next(
        (player for player in players if player["role"] == "loup_blanc"), None
    )
    if white_wolf and white_wolf.get("alive", True):
        white_index = players.index(white_wolf)
        lovers = game["lovers"]
        allowed_indices = {white_index}
        if lovers and white_index in lovers:
            allowed_indices.update(lovers)
        living_indices = {
            index for index, player in enumerate(players) if player.get("alive", True)
        }
        if living_indices.issubset(allowed_indices):
            winners.append("loup_blanc")
    lovers = game["lovers"]
    if lovers and len(alive) == 2 and all(
        players[index].get("alive", True) for index in lovers
    ):
        first_role, second_role = (
            players[index]["role"] for index in lovers
        )
        first_camp = (
            "meute" if first_role in PACK_ROLES
            else "independent" if first_role == "loup_blanc"
            else "village"
        )
        second_camp = (
            "meute" if second_role in PACK_ROLES
            else "independent" if second_role == "loup_blanc"
            else "village"
        )
        if first_camp != second_camp:
            winners.append("amoureux")
    return winners


def finish_hunter_chain(room: dict[str, Any], after_hunters: str) -> None:
    game = room["game"]
    game["action_index"] = 0
    if game["actions"]:
        game["phase"] = "hunter"
        return

    game["winners"] = check_winners(room)
    if game["winners"]:
        game["phase"] = "finished"
        game["message"] = "La partie est terminée."
    elif after_hunters == "day":
        game["phase"] = "day"
        game["votes"] = {}
        game["message"] = "Le village débat puis vote."
    else:
        game["round"] += 1
        prepare_night(room)
        game["message"] = f"La nuit {game['round']} commence."


def resolve_night(room: dict[str, Any]) -> None:
    game = room["game"]
    deaths = []
    pack_target = game["pack_target"]
    if pack_target is not None and not game["witch_save"]:
        deaths.append(pack_target)
    if game["white_wolf_target"] is not None:
        deaths.append(game["white_wolf_target"])
    if game["witch_kill_target"] is not None:
        deaths.append(game["witch_kill_target"])
    game["actions"] = []
    game["action_index"] = 0
    game["after_hunters"] = "day"
    previous_death_count = len(game["deaths"])
    add_deaths(room, deaths, "la nuit")
    game["message"] = (
        "Le village se réveille après une nuit meurtrière."
        if len(game["deaths"]) > previous_death_count
        else "Le village se réveille : personne n’a été éliminé cette nuit."
    )
    finish_hunter_chain(room, "day")


def public_game_state(room: dict[str, Any]) -> dict[str, Any]:
    game = room["game"]
    action = current_action(room)
    return {
        "phase": game["phase"],
        "round": game["round"],
        "alive_players": [
            player["name"] for player in room["players"] if player.get("alive", True)
        ],
        "alive_indices": [
            index for index, player in enumerate(room["players"])
            if player.get("alive", True)
        ],
        "deaths": game["deaths"],
        "current_actor": (
            room["players"][action["actor_index"]]["name"] if action else None
        ),
        "votes_received": len(game["votes"]),
        "voted_indices": sorted(game["votes"]),
        "vote_total": sum(player.get("alive", True) for player in room["players"]),
        "winners": game["winners"],
        "message": game["message"],
    }


def game_action_prompt(
    room: dict[str, Any], actor_index: int
) -> dict[str, Any] | None:
    game = room["game"]
    players = room["players"]
    targets = [
        {"value": str(index), "label": player["name"]}
        for index, player in enumerate(players)
        if player.get("alive", True) and index != actor_index
    ]

    def select(name: str, label: str, options: list[dict[str, str]], required: bool):
        return {
            "name": name,
            "label": label,
            "options": options,
            "required": required,
        }

    action = current_action(room)
    if game["phase"] == "day":
        player = players[actor_index]
        if not player.get("alive", True) or actor_index in game["votes"]:
            return None
        return {
            "kind": "vote",
            "prompt": "Choisis qui éliminer, ou abstiens-toi.",
            "fields": [
                select(
                    "target",
                    "Vote",
                    [{"value": "", "label": "Abstention"}] + targets,
                    False,
                )
            ],
            "button": "Valider mon vote",
        }
    if not action or action["actor_index"] != actor_index:
        return None

    kind = action["kind"]
    if kind == "cupidon":
        return {
            "kind": kind,
            "prompt": "Première nuit : lie deux joueurs amoureux.",
            "fields": [
                select("first_target", "Premier amoureux", targets, True),
                select("second_target", "Deuxième amoureux", targets, True),
            ],
            "button": "Lier les amoureux",
        }
    if kind == "wolf_vote":
        options = [
            {"value": str(index), "label": player["name"]}
            for index, player in enumerate(players)
            if player.get("alive", True) and player["role"] not in PACK_ROLES
        ]
        return {
            "kind": kind,
            "prompt": "La meute choisit sa victime.",
            "fields": [select("target", "Victime de la meute", options, True)],
            "button": "Voter pour la victime",
        }
    if kind == "enrage":
        options = [{"value": "", "label": "Ne pas utiliser ce pouvoir"}] + [
            {"value": str(index), "label": player["name"]}
            for index, player in enumerate(players)
            if player.get("alive", True) and player["role"] not in PACK_ROLES
        ]
        return {
            "kind": kind,
            "prompt": "Tu peux convertir une fois un joueur vivant en Loup-Garou ordinaire. Il perd son ancien rôle.",
            "fields": [select("target", "Joueur à convertir", options, False)],
            "button": "Valider",
        }
    if kind == "white_wolf":
        return {
            "kind": kind,
            "prompt": "Cette nuit, tu peux éliminer un joueur de ton choix.",
            "fields": [
                select(
                    "target",
                    "Joueur à éliminer",
                    [{"value": "", "label": "Ne pas utiliser ce pouvoir"}] + targets,
                    False,
                )
            ],
            "button": "Valider",
        }
    if kind == "witch":
        pack_target = game["pack_target"]
        save_options = [
            {"value": "no", "label": "Non"},
            {"value": "yes", "label": "Oui"},
        ]
        kill_options = [{"value": "", "label": "Ne pas utiliser la potion"}] + targets
        fields = []
        if not game["witch_life_used"]:
            fields.append(
                select("save", "Sauver la victime de la meute ?", save_options, True)
            )
        if not game["witch_death_used"]:
            fields.append(
                select("kill_target", "Potion de mort", kill_options, False)
            )
        victim = (
            players[pack_target]["name"]
            if pack_target is not None
            else "aucune victime choisie par la meute"
        )
        return {
            "kind": kind,
            "prompt": f"La victime de la meute est : {victim}. Tu peux utiliser chacune de tes potions une seule fois.",
            "fields": fields,
            "button": "Utiliser / conserver mes potions",
        }
    if kind == "seer":
        return {
            "kind": kind,
            "prompt": "Découvre le rôle d'un joueur vivant.",
            "fields": [select("target", "Joueur à sonder", targets, True)],
            "button": "Découvrir son rôle",
        }
    if kind == "hunter":
        return {
            "kind": kind,
            "prompt": "Tu es mort, mais ton dernier geste de Chasseur peut éliminer un joueur vivant.",
            "fields": [select("target", "Joueur à éliminer", targets, True)],
            "button": "Tirer",
        }
    return None


def room_view(room: dict[str, Any], viewer_id: str) -> dict[str, Any]:
    player_count = len(room["players"])
    composition = room["composition"] or default_composition(player_count)
    counts = composition_counts(player_count, composition) if composition else None
    now = time.monotonic()
    players = [
        {
            "name": player["name"],
            "ready": player["ready"],
            "online": now - player["last_seen"] <= PRESENCE_TIMEOUT_SECONDS,
        }
        if room["mode"] == "online"
        else {"name": player["name"]}
        for player in room["players"]
    ]
    host = next(player for player in room["players"] if player["id"] == room["host_id"])
    host_online = (
        room["mode"] != "online"
        or now - host["last_seen"] <= PRESENCE_TIMEOUT_SECONDS
    )
    all_ready = bool(room["players"]) and all(
        player["ready"]
        and now - player["last_seen"] <= PRESENCE_TIMEOUT_SECONDS
        for player in room["players"]
    )
    return {
        "code": room["code"],
        "mode": room["mode"],
        "players": players,
        "player_count": player_count,
        "minimum_players": MIN_PLAYERS,
        "maximum_players": MAX_PLAYERS,
        "composition": counts,
        "composition_customized": room["composition_customized"],
        "local_named_indices": sorted(room["local_named_indices"]),
        "local_role_viewed_indices": sorted(room["local_role_viewed_indices"]),
        "can_start": (
            MIN_PLAYERS <= player_count <= MAX_PLAYERS
            and not room["started"]
            and (room["mode"] != "online" or (all_ready and host_online))
        ),
        "is_host": viewer_id == room["host_id"],
        "viewer_ready": next(
            player["ready"] for player in room["players"]
            if player["id"] == viewer_id
        ),
        "host_online": host_online,
        "all_ready": all_ready,
        "started": room["started"],
        "game": public_game_state(room) if room["game"] else None,
    }


@app.get("/")
def home():
    return render_template(
        "index.html", minimum_players=MIN_PLAYERS, maximum_players=MAX_PLAYERS
    )


@app.get("/cards/<role_id>")
def role_card(role_id: str):
    role = ROLE_CARDS.get(role_id)
    if role is None:
        return jsonify(error="Carte de rôle inconnue."), 404
    return send_from_directory(
        Path(__file__).parent / "ressources" / "Img" / "cartes", role[1]
    )


@app.get("/resources/<path:asset_path>")
def resource_asset(asset_path: str):
    base_dir = Path(__file__).parent / "ressources" / "Img"
    requested = Path(asset_path)
    if asset_path.lower() == "icone_profil.jpeg":
        requested = Path("cartes/icone.jpeg")

    search_roots = [base_dir]
    if requested.parts and requested.parts[0] != "cartes":
        search_roots.append(base_dir / "cartes")

    for search_root in search_roots:
        search_dir = search_root
        for part in requested.parts[:-1]:
            search_dir = search_dir / part
        matches = [
            candidate for candidate in search_dir.iterdir()
            if candidate.name.lower() == requested.name.lower()
        ]
        if matches:
            return send_from_directory(search_dir, matches[0].name)

    return jsonify(error="Ressource introuvable."), 404


@app.post("/api/rooms")
def create_room_route():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="La requête n’est pas valide."), 400

    mode = data.get("mode")
    names = data.get("players") if mode == "local" else [data.get("name")]
    if not isinstance(names, list):
        return jsonify(error="La liste des joueurs n’est pas valide."), 400

    try:
        room = create_room(mode, names)
    except ValueError as error:
        return jsonify(error=str(error)), 400

    session["room_code"] = room["code"]
    session["player_id"] = room["host_id"]
    return jsonify(room_view(room, room["host_id"])), 201


@app.post("/api/rooms/join")
def join_room_route():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="La requête n’est pas valide."), 400

    try:
        name = clean_name(data.get("name"))
    except ValueError as error:
        return jsonify(error=str(error)), 400

    code = data.get("code")
    if not isinstance(code, str):
        return jsonify(error="Entre le code du salon."), 400
    code = code.strip().upper()

    with rooms_lock:
        room = rooms.get(code)
        if room is None:
            return jsonify(error="Salon introuvable. Vérifie le code."), 404
        if room["mode"] != "online":
            return jsonify(error="Ce salon est réservé au mode local."), 400
        if room["started"]:
            return jsonify(error="Une partie est en cours."), 409
        existing_player = next(
            (
                player for player in room["players"]
                if player["name"].casefold() == name.casefold()
            ),
            None,
        )
        if existing_player:
            if time.monotonic() - existing_player["last_seen"] <= PRESENCE_TIMEOUT_SECONDS:
                return jsonify(error="Ce nom est déjà utilisé dans le salon."), 409
            player_id = existing_player["id"]
            existing_player["last_seen"] = time.monotonic()
        else:
            if len(room["players"]) >= MAX_PLAYERS:
                return jsonify(error=f"Ce salon a atteint sa limite de {MAX_PLAYERS} joueurs."), 409
            player_id = secrets.token_urlsafe(16)
            room["players"].append({
                "id": player_id,
                "name": name,
                "ready": False,
                "last_seen": time.monotonic(),
            })
            if not room["composition_customized"]:
                room["composition"] = default_composition(len(room["players"]))
        view = room_view(room, player_id)

    session["room_code"] = code
    session["player_id"] = player_id
    return jsonify(view), 200


@app.get("/api/rooms/<code>")
def get_room_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if session.get("room_code") != room_code or not any(
            player["id"] == player_id for player in room["players"]
        ):
            return jsonify(error="Tu ne fais pas partie de ce salon."), 403
        if room["mode"] == "online":
            next(player for player in room["players"] if player["id"] == player_id)[
                "last_seen"
            ] = time.monotonic()
        return jsonify(room_view(room, player_id))


@app.post("/api/rooms/<code>/leave")
def leave_room_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if room["mode"] != "online":
            return jsonify(error="Cette action est réservée aux salons à distance."), 400
        if session.get("room_code") != room_code or not any(
            player["id"] == player_id for player in room["players"]
        ):
            return jsonify(error="Tu ne fais pas partie de ce salon."), 403
        player = next(player for player in room["players"] if player["id"] == player_id)
        player["last_seen"] = 0
    session.pop("room_code", None)
    session.pop("player_id", None)
    return jsonify(success=True)


@app.post("/api/rooms/<code>/ready")
def set_player_ready_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("ready"), bool):
        return jsonify(error="Le statut de préparation n’est pas valide."), 400

    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if room["mode"] != "online":
            return jsonify(error="Cette action est réservée aux salons à distance."), 400
        if session.get("room_code") != room_code or not any(
            player["id"] == player_id for player in room["players"]
        ):
            return jsonify(error="Tu ne fais pas partie de ce salon."), 403
        if room["started"]:
            return jsonify(error="La partie a déjà commencé."), 409
        player = next(player for player in room["players"] if player["id"] == player_id)
        player["ready"] = data["ready"]
        player["last_seen"] = time.monotonic()
        return jsonify(room_view(room, player_id))


@app.post("/api/rooms/<code>/composition")
def update_composition_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="La requête n’est pas valide."), 400

    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if session.get("room_code") != room_code or player_id != room["host_id"]:
            return jsonify(error="Seule la personne qui a créé le salon peut modifier les rôles."), 403
        if room["started"]:
            return jsonify(error="La composition ne peut plus être modifiée après le lancement."), 409
        if not MIN_PLAYERS <= len(room["players"]) <= MAX_PLAYERS:
            return jsonify(error=f"Il faut entre {MIN_PLAYERS} et {MAX_PLAYERS} joueurs pour régler les rôles."), 409
        try:
            composition = validate_composition(data, len(room["players"]))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        room["composition"] = composition
        room["composition_customized"] = True
        return jsonify(room_view(room, player_id))


@app.post("/api/rooms/<code>/start")
def start_room_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if session.get("room_code") != room_code or player_id != room["host_id"]:
            return jsonify(error="Seule la personne qui a créé le salon peut lancer la partie."), 403
        if room["started"]:
            return jsonify(error="La partie a déjà commencé."), 409
        if room["mode"] == "online":
            host = next(player for player in room["players"] if player["id"] == room["host_id"])
            if time.monotonic() - host["last_seen"] > PRESENCE_TIMEOUT_SECONDS:
                return jsonify(error="La personne hôte doit être présente pour lancer la partie."), 409
            if not all(
                player["ready"]
                and time.monotonic() - player["last_seen"] <= PRESENCE_TIMEOUT_SECONDS
                for player in room["players"]
            ):
                return jsonify(error="Tous les joueurs doivent être présents et prêts avant le lancement."), 409
        player_count = len(room["players"])
        if not MIN_PLAYERS <= player_count <= MAX_PLAYERS:
            return jsonify(error=f"Il faut entre {MIN_PLAYERS} et {MAX_PLAYERS} joueurs pour commencer."), 409
        composition = room["composition"] or default_composition(player_count)
        if composition is None:
            return jsonify(error="Impossible de préparer cette composition."), 409
        try:
            composition = validate_composition(composition, player_count)
        except ValueError as error:
            return jsonify(error=str(error)), 409
        counts = composition_counts(player_count, composition)
        roles = composition["special_roles"] + composition["wolf_roles"]
        roles += ["loup_garou"] * (counts["wolf_count"] - len(composition["wolf_roles"]))
        roles += ["villageois"] * counts["villager_count"]
        secrets.SystemRandom().shuffle(roles)
        for player, role in zip(room["players"], roles):
            player["role"] = role
        room["composition"] = composition
        room["started"] = True
        initialize_game(room, dealing=room["mode"] == "local")
        return jsonify(room_view(room, player_id))


@app.post("/api/rooms/<code>/game/begin")
def begin_game_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if (
            room["mode"] != "local"
            or session.get("room_code") != room_code
            or player_id != room["host_id"]
        ):
            return jsonify(error="Seule la personne hôte peut commencer une partie locale."), 403
        if not room["started"] or room["game"] is None:
            return jsonify(error="Les rôles ne sont pas encore distribués."), 409
        if room["game"]["phase"] != "dealing":
            return jsonify(error="La partie a déjà commencé."), 409
        expected = set(range(len(room["players"])))
        if (
            room["local_named_indices"] != expected
            or room["local_role_viewed_indices"] != expected
        ):
            return jsonify(error="Chaque joueur doit avoir saisi son pseudo et découvert son rôle."), 409
        initialize_game(room)
        return jsonify(room_view(room, player_id))


@app.get("/api/rooms/<code>/game")
def get_game_state_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if session.get("room_code") != room_code:
            return jsonify(error="Tu ne fais pas partie de ce salon."), 403
        if room["mode"] == "local":
            if player_id != room["host_id"]:
                return jsonify(error="Seule la personne hôte peut gérer la partie locale."), 403
            actor_index = request.args.get("player_index", type=int)
            if actor_index is None or not 0 <= actor_index < len(room["players"]):
                return jsonify(error="Joueur local inconnu."), 400
        else:
            actor_index = next(
                (
                    index for index, player in enumerate(room["players"])
                    if player["id"] == player_id
                ),
                None,
            )
            if actor_index is None:
                return jsonify(error="Tu ne fais pas partie de ce salon."), 403
            next(
                player for player in room["players"] if player["id"] == player_id
            )["last_seen"] = time.monotonic()

        if room["game"] is None:
            return jsonify(error="La partie n’a pas commencé."), 409
        private_result = room["game"]["private_results"].get(str(actor_index))
        return jsonify({
            "state": public_game_state(room),
            "action": game_action_prompt(room, actor_index),
            "private_result": private_result,
        })


@app.post("/api/rooms/<code>/game/action")
def submit_game_action_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="La requête n’est pas valide."), 400

    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if session.get("room_code") != room_code:
            return jsonify(error="Tu ne fais pas partie de ce salon."), 403
        if room["mode"] == "local":
            if player_id != room["host_id"]:
                return jsonify(error="Seule la personne hôte peut gérer la partie locale."), 403
            actor_index = data.get("player_index")
            if (
                isinstance(actor_index, bool)
                or not isinstance(actor_index, int)
                or not 0 <= actor_index < len(room["players"])
            ):
                return jsonify(error="Joueur local inconnu."), 400
        else:
            actor_index = next(
                (
                    index for index, player in enumerate(room["players"])
                    if player["id"] == player_id
                ),
                None,
            )
            if actor_index is None:
                return jsonify(error="Tu ne fais pas partie de ce salon."), 403

        game = room["game"]
        if not room["started"] or game is None or game["phase"] in {"dealing", "finished"}:
            return jsonify(error="Aucune action n’est attendue actuellement."), 409

        prompt = game_action_prompt(room, actor_index)
        if prompt is None:
            return jsonify(error="Ce n’est pas ton tour ou tu as déjà agi."), 409

        def target_value(field: str, *, required: bool = True) -> int | None:
            value = data.get(field)
            if value is None or value == "":
                if required:
                    raise ValueError("Choisis un joueur.")
                return None
            if isinstance(value, bool):
                raise ValueError("Le joueur choisi n’est pas valide.")
            try:
                index = int(value)
            except (TypeError, ValueError) as error:
                raise ValueError("Le joueur choisi n’est pas valide.") from error
            if not 0 <= index < len(room["players"]):
                raise ValueError("Le joueur choisi n’est pas valide.")
            if index == actor_index:
                raise ValueError("Tu ne peux pas te choisir toi-même.")
            if not room["players"][index].get("alive", True):
                raise ValueError("Ce joueur n’est plus en vie.")
            return index

        try:
            kind = prompt["kind"]
            if kind == "vote":
                target = target_value("target", required=False)
                game["votes"][actor_index] = target
                living_count = sum(
                    player.get("alive", True) for player in room["players"]
                )
                if len(game["votes"]) == living_count:
                    tallies: dict[int, int] = {}
                    for vote in game["votes"].values():
                        if vote is not None:
                            tallies[vote] = tallies.get(vote, 0) + 1
                    if tallies:
                        highest = max(tallies.values())
                        leaders = [
                            index for index, count in tallies.items()
                            if count == highest
                        ]
                        executed = leaders[0] if len(leaders) == 1 else None
                    else:
                        executed = None
                    game["actions"] = []
                    game["action_index"] = 0
                    game["after_hunters"] = "night"
                    if executed is None:
                        game["message"] = "Le vote est terminé sans élimination (égalité ou abstentions)."
                    else:
                        game["message"] = (
                            f"{room['players'][executed]['name']} est éliminé par le village."
                        )
                        add_deaths(room, [executed], "le vote du village")
                    finish_hunter_chain(room, "night")
            else:
                action = current_action(room)
                if action is None or action["actor_index"] != actor_index:
                    return jsonify(error="Ce n’est pas ton tour."), 409

                if kind == "cupidon":
                    first = target_value("first_target")
                    second = target_value("second_target")
                    if first == second:
                        raise ValueError("Choisis deux joueurs différents.")
                    game["lovers"] = [first, second]
                    game["message"] = "Cupidon a lié deux joueurs."
                elif kind == "wolf_vote":
                    target = target_value("target")
                    if room["players"][target]["role"] in PACK_ROLES:
                        raise ValueError("La meute ne peut pas choisir l’un des siens.")
                    game["pack_votes"].append((actor_index, target))
                elif kind == "enrage":
                    target = target_value("target", required=False)
                    if target is not None:
                        if room["players"][target]["role"] in PACK_ROLES:
                            raise ValueError("La meute ne peut pas convertir l’un des siens.")
                        game["enraged_target"] = target
                        game["enraged_used"] = True
                        room["players"][target]["role"] = "loup_garou"
                        game["private_results"][str(target)] = (
                            "Tu as été contaminé : tu es désormais Loup-Garou et tu as perdu ton ancien rôle et ses pouvoirs."
                        )
                        completed_and_current = game["actions"][
                            :game["action_index"] + 1
                        ]
                        remaining = [
                            queued
                            for queued in game["actions"][game["action_index"] + 1:]
                            if queued["actor_index"] != target
                        ]
                        game["actions"] = completed_and_current + remaining
                elif kind == "white_wolf":
                    game["white_wolf_target"] = target_value("target", required=False)
                elif kind == "witch":
                    if not game["witch_life_used"]:
                        save = data.get("save", "no")
                        if save not in {"yes", "no"}:
                            raise ValueError("Le choix de la potion de vie n’est pas valide.")
                        if save == "yes":
                            game["witch_save"] = True
                            game["witch_life_used"] = True
                    if not game["witch_death_used"]:
                        kill_target = target_value("kill_target", required=False)
                        if kill_target is not None:
                            game["witch_kill_target"] = kill_target
                            game["witch_death_used"] = True
                elif kind == "seer":
                    target = target_value("target")
                    role_id = room["players"][target]["role"]
                    role_name = ROLE_CARDS[role_id][0]
                    game["private_results"][str(actor_index)] = (
                        f"{room['players'][target]['name']} est {role_name}."
                    )
                elif kind == "hunter":
                    target = target_value("target")
                    game["actions"].pop(0)
                    game["action_index"] = 0
                    add_deaths(room, [target], "le tir du Chasseur")
                    game["message"] = (
                        f"Le Chasseur a éliminé {room['players'][target]['name']}."
                    )
                    if game["actions"]:
                        game["phase"] = "hunter"
                    else:
                        finish_hunter_chain(room, game["after_hunters"])
                    if room["mode"] == "online":
                        room["players"][actor_index]["last_seen"] = time.monotonic()
                    return jsonify({
                        "state": public_game_state(room),
                        "action": game_action_prompt(room, actor_index),
                    })
                else:
                    raise ValueError("Action de jeu inconnue.")

                game["action_index"] += 1
                next_action = current_action(room)
                if kind == "wolf_vote" and (
                    next_action is None or next_action["kind"] != "wolf_vote"
                ):
                    tallies = {}
                    for _, vote in game["pack_votes"]:
                        tallies[vote] = tallies.get(vote, 0) + 1
                    if tallies:
                        highest = max(tallies.values())
                        leaders = [
                            index for index, count in tallies.items()
                            if count == highest
                        ]
                        game["pack_target"] = leaders[0] if len(leaders) == 1 else None
                if game["action_index"] >= len(game["actions"]):
                    resolve_night(room)
                elif game["phase"] == "hunter":
                    game["action_index"] = 0
        except ValueError as error:
            return jsonify(error=str(error)), 400

        if room["mode"] == "online":
            room["players"][actor_index]["last_seen"] = time.monotonic()
        return jsonify({
            "state": public_game_state(room),
            "action": game_action_prompt(room, actor_index),
            "private_result": game["private_results"].get(str(actor_index)),
        })


@app.post("/api/rooms/<code>/players/<int:player_index>/name")
def update_local_player_name_route(code: str, player_index: int):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="La requête n’est pas valide."), 400

    try:
        name = clean_name(data.get("name"))
    except ValueError as error:
        return jsonify(error=str(error)), 400

    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if room["mode"] != "local":
            return jsonify(error="Cette action est réservée aux parties locales."), 400
        if session.get("room_code") != room_code or player_id != room["host_id"]:
            return jsonify(error="Seule la personne qui a créé la partie peut modifier les noms."), 403
        if not room["started"]:
            return jsonify(error="La distribution des rôles n’a pas commencé."), 409
        if not 0 <= player_index < len(room["players"]):
            return jsonify(error="Joueur local inconnu."), 400
        if player_index in room["local_named_indices"]:
            return jsonify(error="Un pseudo a déjà été saisi pour cette case."), 409
        if any(
            room["players"][index]["name"].casefold() == name.casefold()
            for index in room["local_named_indices"]
        ):
            return jsonify(error="Chaque joueur doit avoir un nom différent."), 400

        room["players"][player_index]["name"] = name
        room["local_named_indices"].add(player_index)
        return jsonify(room_view(room, player_id))


@app.get("/api/rooms/<code>/role")
def get_player_role_route(code: str):
    room_code = code.strip().upper()
    player_id = session.get("player_id")
    with rooms_lock:
        room = rooms.get(room_code)
        if room is None:
            return jsonify(error="Salon introuvable."), 404
        if session.get("room_code") != room_code or not any(
            player["id"] == player_id for player in room["players"]
        ):
            return jsonify(error="Tu ne fais pas partie de ce salon."), 403
        if not room["started"]:
            return jsonify(error="Les rôles ne sont pas encore distribués."), 409

        if room["mode"] == "local":
            if player_id != room["host_id"]:
                return jsonify(error="Seule la personne qui a créé la partie peut distribuer les rôles en local."), 403
            index = request.args.get("player_index", type=int)
            if index is None or not 0 <= index < len(room["players"]):
                return jsonify(error="Joueur local inconnu."), 400
            if index not in room["local_named_indices"]:
                return jsonify(error="Saisis d’abord le pseudo de ce joueur."), 409
            player = room["players"][index]
            room["local_role_viewed_indices"].add(index)
        else:
            player = next(player for player in room["players"] if player["id"] == player_id)

        role_id = player["role"]
        role_name, _, description = ROLE_CARDS[role_id]
        return jsonify({
            "name": role_name,
            "description": description,
            "image": f"/cards/{role_id}",
            "player_name": player["name"] if room["mode"] == "local" else None,
        })


@app.errorhandler(413)
def request_too_large(_error):
    return jsonify(error="La requête est trop volumineuse."), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False)
