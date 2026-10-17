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
    "sorciere": ("Sorcière", "Sorciere.jpeg", "Les secrets de la Sorcière restent à découvrir."),
    "cupidon": ("Cupidon", "Cupidon.jpeg", "Le destin de Cupidon reste à découvrir."),
    "chasseur": ("Chasseur", "Chasseur.jpeg", "Le secret du Chasseur reste à découvrir."),
    "loup_garou": ("Loup-Garou", "Loup_Garou.jpeg", "Tu fais partie de la meute."),
    "loup_enrage": ("Loup Enragé", "Loup_Enrage.jpeg", "Une fois dans la partie, tu peux infecter la victime choisie par la meute. Elle devient Loup-Garou et perd son rôle spécial."),
    "loup_blanc": ("Loup Blanc", "Loup_Blanc.jpeg", "Tu votes avec la meute chaque nuit. À partir de la nuit 2, une nuit sur deux, tu peux dévorer seul un joueur, même protégé. Tu dois finir seul, sauf si tu es amoureux."),
    "villageois": ("Villageois", "Villageois.jpeg", "Tu es un Villageois. Le village compte sur toi."),
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
        }
        rooms[code] = room
    return room


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
        return jsonify(room_view(room, player_id))


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
