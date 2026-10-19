import unittest

from Wolfie.app import (
    DAY_ACTION_SECONDS,
    MIN_PLAYERS,
    NIGHT_ACTION_SECONDS,
    SPECIAL_ACTION_SECONDS,
    app,
    ensure_game_timer,
    check_winners,
    initialize_game,
    prepare_night,
    rooms,
    rooms_lock,
)


class MainRoleGameplayTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="game-test-secret")
        self.clients = [app.test_client() for _ in range(MIN_PLAYERS)]

    def tearDown(self):
        with rooms_lock:
            rooms.clear()

    def create_started_room(self):
        host = self.clients[0]
        created = host.post(
            "/api/rooms", json={"mode": "online", "name": "Joueur 0"}
        )
        self.assertEqual(created.status_code, 201)
        code = created.get_json()["code"]
        for index in range(1, MIN_PLAYERS):
            joined = self.clients[index].post(
                "/api/rooms/join",
                json={"code": code, "name": f"Joueur {index}"},
            )
            self.assertEqual(joined.status_code, 200)
            ready = self.clients[index].post(
                f"/api/rooms/{code}/ready", json={"ready": True}
            )
            self.assertEqual(ready.status_code, 200)
        host.post(f"/api/rooms/{code}/ready", json={"ready": True})
        started = host.post(f"/api/rooms/{code}/start", json={})
        self.assertEqual(started.status_code, 200)
        return code

    def set_roles(self, code, roles):
        with rooms_lock:
            room = rooms[code]
            for player, role in zip(room["players"], roles):
                player["role"] = role
            initialize_game(room)
            room["game"]["chief_index"] = 0

    def submit(self, code, player_index, data):
        return self.clients[player_index].post(
            f"/api/rooms/{code}/game/action", json=data
        )

    def test_night_actions_private_seer_result_and_hunter_chain(self):
        code = self.create_started_room()
        roles = [
            "cupidon",
            "loup_garou",
            "loup_enrage",
            "sorciere",
            "voyante",
            "chasseur",
        ]
        self.set_roles(code, roles)

        cupid_instruction = self.clients[0].get(
            f"/api/rooms/{code}/game"
        ).get_json()["action"]
        self.assertEqual(cupid_instruction["role"]["name"], "Cupidon")
        self.assertEqual(cupid_instruction["role"]["image"], "/cards/cupidon")
        self.assertEqual(cupid_instruction["actor_index"], 0)
        self.assertIsNone(
            self.clients[5].get(f"/api/rooms/{code}/game").get_json()["action"]
        )

        cupid = self.submit(code, 0, {"first_target": 4, "second_target": 5})
        self.assertEqual(cupid.status_code, 200)
        wolf = self.submit(code, 1, {"target": 5})
        self.assertEqual(wolf.status_code, 200)
        pack_vote = self.submit(code, 2, {"target": 5})
        self.assertEqual(pack_vote.status_code, 200)
        enraged = self.submit(code, 2, {"target": 0})
        self.assertEqual(enraged.status_code, 200)
        saved = self.submit(code, 3, {"save": "yes", "kill_target": ""})
        self.assertEqual(saved.status_code, 200)
        seer = self.submit(code, 4, {"target": 0})
        self.assertEqual(seer.status_code, 200)
        self.assertIn("Loup-Garou", seer.get_json()["private_result"])
        converted_player_notice = self.clients[0].get(
            f"/api/rooms/{code}/game"
        ).get_json()["private_result"]
        self.assertIn("contaminé", converted_player_notice)
        self.assertIsNone(
            self.clients[1].get(f"/api/rooms/{code}/game").get_json()["private_result"]
        )
        self.assertEqual(seer.get_json()["state"]["phase"], "day")

        for index in range(MIN_PLAYERS):
            target = "" if index == 5 else "5"
            vote = self.submit(code, index, {"target": target})
            self.assertEqual(vote.status_code, 200)
        hunter_state = self.clients[5].get(f"/api/rooms/{code}/game").get_json()
        self.assertEqual(hunter_state["state"]["phase"], "hunter")
        self.assertEqual(hunter_state["action"]["kind"], "hunter")

        shot = self.submit(code, 5, {"target": 1})
        self.assertEqual(shot.status_code, 200)
        self.assertEqual(shot.get_json()["state"]["phase"], "night")
        with rooms_lock:
            room = rooms[code]
            self.assertEqual(room["players"][5]["alive"], False)
            self.assertEqual(room["players"][4]["alive"], False)
            self.assertEqual(room["players"][1]["alive"], False)
            self.assertEqual(room["players"][5]["role"], "chasseur")
            self.assertEqual(room["players"][0]["role"], "loup_garou")
            self.assertEqual(room["players"][2]["role"], "loup_enrage")
            self.assertEqual(room["game"]["round"], 2)
            self.assertTrue(room["game"]["witch_life_used"])
            self.assertTrue(room["game"]["enraged_used"])

    def test_action_timers_use_night_and_special_role_durations(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["loup_garou", "voyante", "villageois", "villageois", "villageois", "villageois"],
        )

        wolf_state = self.clients[0].get(f"/api/rooms/{code}/game").get_json()["state"]
        self.assertEqual(wolf_state["timer"]["duration"], NIGHT_ACTION_SECONDS)

        with rooms_lock:
            timer = ensure_game_timer(rooms[code])
            self.assertEqual(timer["duration"], NIGHT_ACTION_SECONDS)
            rooms[code]["game"]["action_index"] = 1
            rooms[code]["game"]["timer_key"] = None
        seer_state = self.clients[1].get(f"/api/rooms/{code}/game").get_json()["state"]
        self.assertEqual(seer_state["timer"]["duration"], SPECIAL_ACTION_SECONDS)

    def test_expired_night_action_is_skipped_without_selecting_a_target(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["villageois", "loup_garou", "villageois", "villageois", "villageois", "villageois"],
        )
        with rooms_lock:
            ensure_game_timer(rooms[code])
            rooms[code]["game"]["timer_deadline"] = 0

        response = self.clients[0].get(f"/api/rooms/{code}/game")
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertTrue(result["timer_expired"])
        self.assertEqual(result["state"]["phase"], "day")
        self.assertEqual(result["state"]["timer"]["duration"], DAY_ACTION_SECONDS)
        self.assertEqual(result["state"]["alive_players"], [f"Joueur {i}" for i in range(MIN_PLAYERS)])
        with rooms_lock:
            self.assertIsNone(rooms[code]["game"]["pack_target"])

    def test_expired_day_auto_abstains_and_starts_next_night(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["loup_garou", "villageois", "villageois", "villageois", "villageois", "villageois"],
        )
        with rooms_lock:
            room = rooms[code]
            room["game"].update(
                phase="day",
                actions=[],
                action_index=0,
                votes={},
            )
            ensure_game_timer(room)
            room["game"]["timer_deadline"] = 0

        response = self.clients[0].get(f"/api/rooms/{code}/game")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["timer_expired"])
        self.assertEqual(response.get_json()["state"]["phase"], "night")

    def test_expired_chief_succession_selects_a_living_player(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["loup_garou", "villageois", "villageois", "villageois", "villageois", "villageois"],
        )
        with rooms_lock:
            room = rooms[code]
            room["players"][0]["alive"] = False
            room["game"].update(
                phase="chief",
                actions=[{"actor_index": 0, "kind": "chief_successor"}],
                action_index=0,
                chief_index=0,
                after_hunters="night",
            )
            ensure_game_timer(room)
            room["game"]["timer_deadline"] = 0

        response = self.clients[0].get(f"/api/rooms/{code}/game")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["timer_expired"])
        successor_index = response.get_json()["state"]["chief_index"]
        self.assertIn(successor_index, range(1, MIN_PLAYERS))
        self.assertTrue(rooms[code]["players"][successor_index]["alive"])

    def test_tied_vote_without_a_living_chief_skips_elimination(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["villageois", "loup_garou", "villageois", "villageois", "villageois", "villageois"],
        )
        with rooms_lock:
            rooms[code]["players"][0]["alive"] = False
            rooms[code]["game"].update(
                phase="day",
                actions=[],
                action_index=0,
                votes={},
                deaths=[{"name": "Joueur 0", "cause": "la nuit"}],
                chief_index=0,
            )

        targets = [None, 2, 1, 2, 1, ""]
        for player_index, target in enumerate(targets):
            if player_index == 0:
                continue
            response = self.submit(code, player_index, {"target": target})
            self.assertEqual(response.status_code, 200, response.get_json())

        state = response.get_json()["state"]
        self.assertEqual(state["phase"], "night")
        self.assertEqual(state["round"], 2)
        self.assertEqual(state["deaths"], [{"name": "Joueur 0", "cause": "la nuit"}])
        self.assertIn("aucun Chef", state["message"])

    def test_do_nothing_skips_each_night_action_without_using_powers(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "cupidon",
                "loup_garou",
                "loup_enrage",
                "sorciere",
                "voyante",
                "villageois",
            ],
        )

        for player_index in (0, 1, 2, 2, 3, 4):
            response = self.submit(code, player_index, {"do_nothing": True})
            self.assertEqual(response.status_code, 200, response.get_json())

        with rooms_lock:
            game = rooms[code]["game"]
            self.assertEqual(game["phase"], "day")
            self.assertIsNone(game["lovers"])
            self.assertEqual(game["pack_votes"], [])
            self.assertFalse(game["enraged_used"])
            self.assertFalse(game["witch_life_used"])
            self.assertFalse(game["witch_death_used"])

    def test_do_nothing_on_tied_vote_skips_tiebreak_without_elimination(self):
        code = self.create_started_room()
        with rooms_lock:
            room = rooms[code]
            room["players"][0]["role"] = "loup_garou"
            initialize_game(room)
            room["game"].update(
                phase="chief",
                actions=[{
                    "actor_index": 0,
                    "kind": "chief_tiebreak",
                    "candidates": [1, 2],
                }],
                action_index=0,
                chief_index=0,
            )

        response = self.submit(code, 0, {"do_nothing": True})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["state"]["phase"], "night")
        self.assertEqual(response.get_json()["state"]["deaths"], [])

    def test_do_nothing_on_chief_succession_leaves_no_chief(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["villageois", "loup_garou", "villageois", "villageois", "villageois", "villageois"],
        )
        with rooms_lock:
            room = rooms[code]
            room["players"][0]["alive"] = False
            room["game"].update(
                phase="chief",
                actions=[{"actor_index": 0, "kind": "chief_successor"}],
                action_index=0,
                chief_index=0,
                after_hunters="night",
            )

        response = self.submit(code, 0, {"do_nothing": True})

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.get_json()["state"]["chief_index"])

    def test_local_game_must_finish_role_reveal_before_play(self):
        host = self.clients[0]
        created = host.post(
            "/api/rooms",
            json={
                "mode": "local",
                "players": [f"Joueur {index}" for index in range(MIN_PLAYERS)],
            },
        )
        self.assertEqual(created.status_code, 201)
        code = created.get_json()["code"]
        started = host.post(f"/api/rooms/{code}/start", json={})
        self.assertEqual(started.status_code, 200)
        premature = host.post(f"/api/rooms/{code}/game/begin", json={})
        self.assertEqual(premature.status_code, 409)

        with rooms_lock:
            rooms[code]["local_named_indices"] = set(range(MIN_PLAYERS))
            rooms[code]["local_role_viewed_indices"] = set(range(MIN_PLAYERS))
        begun = host.post(f"/api/rooms/{code}/game/begin", json={})
        self.assertEqual(begun.status_code, 200)
        self.assertEqual(begun.get_json()["game"]["phase"], "night")

    def test_tied_pack_vote_does_not_eliminate_a_player(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "loup_garou",
                "loup_enrage",
                "villageois",
                "villageois",
                "villageois",
                "villageois",
            ],
        )

        self.assertEqual(self.submit(code, 0, {"target": 2}).status_code, 200)
        self.assertEqual(self.submit(code, 1, {"target": 3}).status_code, 200)
        finished_enrage_action = self.submit(code, 1, {"target": ""})

        self.assertEqual(finished_enrage_action.status_code, 200)
        state = finished_enrage_action.get_json()["state"]
        self.assertEqual(state["phase"], "day")
        self.assertEqual(state["deaths"], [])
        self.assertEqual(len(state["alive_players"]), MIN_PLAYERS)

    def test_chief_breaks_a_tied_village_vote_between_tied_players(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "loup_garou",
                "voyante",
                "villageois",
                "villageois",
                "villageois",
                "villageois",
            ],
        )
        with rooms_lock:
            rooms[code]["game"].update(
                phase="day",
                actions=[],
                action_index=0,
                votes={},
                deaths=[],
                chief_index=4,
            )

        choices = [2, 3, 3, 2, None, None]
        for index, target in enumerate(choices):
            result = self.submit(
                code,
                index,
                {"target": "" if target is None else target},
            )
            self.assertEqual(result.status_code, 200)

        state = result.get_json()["state"]
        self.assertEqual(state["phase"], "chief")
        self.assertEqual(state["chief_index"], 4)
        self.assertEqual(state["current_actor"], "Joueur 4")

        chief_state = self.clients[4].get(f"/api/rooms/{code}/game").get_json()
        self.assertEqual(chief_state["action"]["kind"], "chief_tiebreak")
        self.assertEqual(
            {option["value"] for option in chief_state["action"]["fields"][0]["options"]},
            {"2", "3"},
        )
        non_chief_state = self.clients[3].get(f"/api/rooms/{code}/game").get_json()
        self.assertIsNone(non_chief_state["action"])

        invalid_tiebreak = self.submit(code, 4, {"target": 1})
        self.assertEqual(invalid_tiebreak.status_code, 400)
        chosen = self.submit(code, 4, {"target": 2})
        self.assertEqual(chosen.status_code, 200)
        self.assertEqual(chosen.get_json()["state"]["phase"], "night")
        self.assertEqual(chosen.get_json()["state"]["round"], 2)
        self.assertEqual(
            chosen.get_json()["state"]["deaths"],
            [{"name": "Joueur 2", "cause": "le choix du Chef"}],
        )

    def test_tied_vote_without_a_chief_skips_elimination(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["loup_garou", "villageois", "villageois", "villageois", "villageois", "villageois"],
        )
        with rooms_lock:
            rooms[code]["game"].update(
                phase="day",
                actions=[],
                action_index=0,
                votes={},
                deaths=[],
                chief_index=None,
                timer_key=None,
            )

        targets = [1, 2, 1, 2, "", ""]
        for player_index, target in enumerate(targets):
            response = self.submit(code, player_index, {"target": target})
            self.assertEqual(response.status_code, 200, response.get_json())

        state = response.get_json()["state"]
        self.assertEqual(state["phase"], "night")
        self.assertEqual(state["round"], 2)
        self.assertIsNone(state["chief_index"])
        self.assertEqual(state["deaths"], [])
        self.assertIn("aucun Chef", state["message"])

    def test_chief_is_assigned_randomly_and_exposed_as_a_public_badge(self):
        code = self.create_started_room()
        state = self.clients[0].get(f"/api/rooms/{code}/game").get_json()["state"]
        self.assertIn(state["chief_index"], range(MIN_PLAYERS))
        with rooms_lock:
            self.assertEqual(
                state["chief_index"],
                rooms[code]["game"]["chief_index"],
            )

    def test_dead_chief_designates_a_successor_before_the_next_night(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "villageois",
                "loup_garou",
                "voyante",
                "villageois",
                "villageois",
                "villageois",
            ],
        )
        with rooms_lock:
            rooms[code]["game"].update(
                phase="day",
                actions=[],
                action_index=0,
                votes={},
                deaths=[],
                after_hunters="night",
                timer_key=None,
            )

        result = None
        for index in range(MIN_PLAYERS):
            target = 1 if index == 0 else 0
            result = self.submit(code, index, {"target": target})
            self.assertEqual(
                result.status_code, 200, f"index={index}: {result.get_json()}"
            )

        self.assertIsNotNone(result)
        self.assertEqual(result.get_json()["state"]["phase"], "chief")
        chief_state = self.clients[0].get(f"/api/rooms/{code}/game").get_json()
        self.assertEqual(chief_state["action"]["kind"], "chief_successor")
        self.assertIsNone(
            self.clients[1].get(f"/api/rooms/{code}/game").get_json()["action"]
        )

        succession = self.submit(code, 0, {"target": 2})

        self.assertEqual(succession.status_code, 200)
        self.assertEqual(succession.get_json()["state"]["phase"], "night")
        self.assertEqual(succession.get_json()["state"]["chief_index"], 2)
        self.assertIn("Joueur 2", succession.get_json()["state"]["message"])
        self.assertEqual(
            succession.get_json()["state"]["deaths"][0]["name"],
            "Joueur 0",
        )

    def test_dead_player_cannot_be_voted_for_and_player_cannot_vote_twice(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "loup_garou",
                "voyante",
                "villageois",
                "villageois",
                "villageois",
                "villageois",
            ],
        )
        with rooms_lock:
            room = rooms[code]
            room["players"][5]["alive"] = False
            room["game"].update(
                phase="day",
                actions=[],
                action_index=0,
                votes={},
                deaths=[{"name": "Joueur 5", "cause": "la nuit"}],
            )

        dead_target = self.submit(code, 0, {"target": 5})
        self.assertEqual(dead_target.status_code, 400)
        self.assertIn("n’est plus en vie", dead_target.get_json()["error"])

        first_vote = self.submit(code, 0, {"target": 2})
        duplicate_vote = self.submit(code, 0, {"target": 3})

        self.assertEqual(first_vote.status_code, 200)
        self.assertEqual(duplicate_vote.status_code, 409)
        self.assertIn("déjà agi", duplicate_vote.get_json()["error"])
        self.assertEqual(
            first_vote.get_json()["state"]["votes_received"],
            1,
        )

    def test_witch_can_save_and_kill_in_the_same_night(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "loup_garou",
                "sorciere",
                "villageois",
                "villageois",
                "villageois",
                "villageois",
            ],
        )

        self.assertEqual(self.submit(code, 0, {"target": 2}).status_code, 200)
        result = self.submit(
            code, 1, {"save": "yes", "kill_target": 3}
        )

        self.assertEqual(result.status_code, 200)
        state = result.get_json()["state"]
        self.assertEqual(state["phase"], "day")
        self.assertEqual(
            {death["name"] for death in state["deaths"]},
            {"Joueur 3"},
        )
        with rooms_lock:
            game = rooms[code]["game"]
            self.assertTrue(game["witch_life_used"])
            self.assertTrue(game["witch_death_used"])

    def test_witch_cannot_reuse_either_potion(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "loup_garou",
                "sorciere",
                "villageois",
                "villageois",
                "villageois",
                "villageois",
            ],
        )
        with rooms_lock:
            rooms[code]["game"].update(
                phase="night",
                actions=[{"actor_index": 1, "kind": "witch"}],
                action_index=0,
                pack_target=2,
                witch_life_used=True,
                witch_death_used=True,
            )

        prompt = self.clients[1].get(f"/api/rooms/{code}/game").get_json()["action"]
        self.assertEqual(prompt["fields"], [])
        reused_life = self.submit(code, 1, {"save": "yes"})
        reused_death = self.submit(code, 1, {"kill_target": 3})

        self.assertEqual(reused_life.status_code, 400)
        self.assertIn("déjà été utilisée", reused_life.get_json()["error"])
        self.assertEqual(reused_death.status_code, 400)
        self.assertIn("déjà été utilisée", reused_death.get_json()["error"])

    def test_witch_cannot_spend_life_potion_when_pack_has_no_victim(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "loup_garou",
                "loup_enrage",
                "sorciere",
                "villageois",
                "villageois",
                "villageois",
            ],
        )
        self.assertEqual(self.submit(code, 0, {"target": 3}).status_code, 200)
        self.assertEqual(self.submit(code, 1, {"target": 4}).status_code, 200)
        self.assertEqual(self.submit(code, 1, {"target": ""}).status_code, 200)

        prompt = self.clients[2].get(f"/api/rooms/{code}/game").get_json()["action"]
        self.assertNotIn("save", {field["name"] for field in prompt["fields"]})
        rejected_save = self.submit(code, 2, {"save": "yes"})
        self.assertEqual(rejected_save.status_code, 400)
        self.assertIn("aucune victime", rejected_save.get_json()["error"])

        with rooms_lock:
            self.assertFalse(rooms[code]["game"]["witch_life_used"])

        skipped = self.submit(code, 2, {})
        self.assertEqual(skipped.status_code, 200)
        self.assertEqual(skipped.get_json()["state"]["phase"], "day")
        with rooms_lock:
            self.assertFalse(rooms[code]["game"]["witch_life_used"])

    def test_enraged_conversion_removes_target_from_night_actions(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "loup_enrage",
                "voyante",
                "villageois",
                "villageois",
                "villageois",
                "villageois",
            ],
        )

        self.assertEqual(self.submit(code, 0, {"target": 2}).status_code, 200)
        converted = self.submit(code, 0, {"target": 1})

        self.assertEqual(converted.status_code, 200)
        state = converted.get_json()["state"]
        self.assertEqual(state["phase"], "day")
        self.assertEqual(converted.get_json()["action"]["kind"], "vote")
        with rooms_lock:
            self.assertEqual(rooms[code]["players"][1]["role"], "loup_garou")
            self.assertNotIn(
                1,
                [action["actor_index"] for action in rooms[code]["game"]["actions"]],
            )
        notice = self.clients[1].get(f"/api/rooms/{code}/game").get_json()
        self.assertIn("contaminé", notice["private_result"])

    def test_last_hunter_does_not_block_game_when_no_targets_remain(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "chasseur",
                "chasseur",
                "villageois",
                "villageois",
                "villageois",
                "villageois",
            ],
        )
        with rooms_lock:
            room = rooms[code]
            for player in room["players"][2:]:
                player["alive"] = False
            room["game"].update(
                phase="hunter",
                actions=[{"actor_index": 0, "kind": "hunter"}],
                action_index=0,
                after_hunters="day",
                lovers=[0, 1],
            )

        shot = self.submit(code, 0, {"target": 1})

        self.assertEqual(shot.status_code, 200)
        self.assertEqual(shot.get_json()["state"]["phase"], "finished")
        self.assertEqual(shot.get_json()["state"]["winners"], ["village"])
        self.assertIsNone(shot.get_json()["action"])

    def test_hunter_death_can_trigger_another_hunter_action(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            [
                "chasseur",
                "chasseur",
                "villageois",
                "loup_garou",
                "villageois",
                "villageois",
            ],
        )
        with rooms_lock:
            room = rooms[code]
            room["players"][0]["alive"] = False
            room["game"].update(
                phase="hunter",
                actions=[{"actor_index": 0, "kind": "hunter"}],
                action_index=0,
                deaths=[{"name": "Joueur 0", "cause": "la nuit"}],
                after_hunters="day",
            )

        first_shot = self.submit(code, 0, {"target": 1})
        self.assertEqual(first_shot.status_code, 200)
        self.assertEqual(first_shot.get_json()["state"]["phase"], "hunter")
        self.assertEqual(first_shot.get_json()["state"]["current_actor"], "Joueur 1")
        next_hunter = self.clients[1].get(f"/api/rooms/{code}/game").get_json()
        self.assertEqual(next_hunter["action"]["kind"], "hunter")

        second_shot = self.submit(code, 1, {"target": 3})

        self.assertEqual(second_shot.status_code, 200)
        state = second_shot.get_json()["state"]
        self.assertEqual(state["phase"], "finished")
        self.assertEqual(state["winners"], ["village"])
        self.assertEqual(
            [death["name"] for death in state["deaths"]],
            ["Joueur 0", "Joueur 1", "Joueur 3"],
        )

    def test_white_wolf_acts_from_night_two_and_wins_with_cross_camp_lover(self):
        room = {
            "players": [
                {"name": "Blanc", "role": "loup_blanc", "alive": True},
                {"name": "Lune", "role": "voyante", "alive": True},
                {"name": "Villageois 1", "role": "villageois", "alive": True},
                {"name": "Villageois 2", "role": "villageois", "alive": True},
                {"name": "Villageois 3", "role": "villageois", "alive": True},
                {"name": "Villageois 4", "role": "villageois", "alive": True},
            ],
        }
        initialize_game(room)
        self.assertFalse(
            any(action["kind"] == "white_wolf" for action in room["game"]["actions"])
        )
        room["game"]["round"] = 2
        prepare_night(room)
        self.assertTrue(
            any(action["kind"] == "white_wolf" for action in room["game"]["actions"])
        )

        for player in room["players"][2:]:
            player["alive"] = False
        room["game"]["lovers"] = [0, 1]
        self.assertEqual(set(check_winners(room)), {"loup_blanc", "amoureux"})

    def test_white_wolf_eliminates_a_target_on_even_night_and_skips_odd_night(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["loup_garou", "loup_blanc", "villageois", "villageois", "villageois", "villageois"],
        )
        with rooms_lock:
            room = rooms[code]
            room["game"]["round"] = 2
            prepare_night(room)

        wolf_vote = self.submit(code, 0, {"target": 2})
        self.assertEqual(wolf_vote.status_code, 200)
        self.assertEqual(wolf_vote.get_json()["state"]["current_actor"], "Joueur 1")
        white_wolf = self.submit(code, 1, {"target": 3})

        self.assertEqual(white_wolf.status_code, 200)
        self.assertEqual(white_wolf.get_json()["state"]["phase"], "day")
        self.assertEqual(
            {death["name"] for death in white_wolf.get_json()["state"]["deaths"]},
            {"Joueur 2", "Joueur 3"},
        )
        with rooms_lock:
            room = rooms[code]
            room["game"]["round"] = 3
            prepare_night(room)
            self.assertFalse(
                any(action["kind"] == "white_wolf" for action in room["game"]["actions"])
            )

    def test_night_action_order_respects_role_deaths_and_one_shot_power(self):
        room = {
            "players": [
                {"name": "Cupidon", "role": "cupidon", "alive": True},
                {"name": "Loup", "role": "loup_garou", "alive": True},
                {"name": "Enragé", "role": "loup_enrage", "alive": True},
                {"name": "Blanc", "role": "loup_blanc", "alive": True},
                {"name": "Sorcière", "role": "sorciere", "alive": True},
                {"name": "Voyante", "role": "voyante", "alive": True},
            ],
        }
        initialize_game(room)
        self.assertEqual(
            [action["kind"] for action in room["game"]["actions"]],
            ["cupidon", "wolf_vote", "wolf_vote", "enrage", "witch", "seer"],
        )

        room["players"][2]["alive"] = False
        room["game"]["round"] = 2
        room["game"]["enraged_used"] = True
        prepare_night(room)

        self.assertEqual(
            [action["kind"] for action in room["game"]["actions"]],
            ["wolf_vote", "white_wolf", "witch", "seer"],
        )

    def test_winner_matrix_for_village_pack_white_wolf_and_lovers(self):
        cases = [
            ("village", ["loup_garou"] + ["villageois"] * 5, [1], None, ["village"]),
            ("meute", ["loup_garou", "loup_enrage"] + ["villageois"] * 4, [0, 1], None, ["meute"]),
            ("white wolf", ["loup_blanc"] + ["villageois"] * 5, [0], None, ["loup_blanc"]),
            ("cross-camp lovers", ["loup_garou", "villageois"] + ["villageois"] * 4, [0, 1], [0, 1], ["amoureux"]),
            ("joint white wolf and lovers", ["loup_blanc", "villageois"] + ["villageois"] * 4, [0, 1], [0, 1], ["loup_blanc", "amoureux"]),
            ("all eliminated", ["loup_garou"] + ["villageois"] * 5, [], None, ["village"]),
        ]
        for label, roles, living, lovers, expected in cases:
            with self.subTest(case=label):
                room = {
                    "players": [
                        {"name": f"Joueur {index}", "role": role, "alive": True}
                        for index, role in enumerate(roles)
                    ]
                }
                initialize_game(room)
                for index, player in enumerate(room["players"]):
                    player["alive"] = index in living
                room["game"]["lovers"] = lovers
                self.assertEqual(check_winners(room), expected)

    def test_pack_cannot_attack_or_convert_its_own_member(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["loup_garou", "loup_enrage", "villageois", "villageois", "villageois", "villageois"],
        )

        friendly_fire = self.submit(code, 0, {"target": 1})
        self.assertEqual(friendly_fire.status_code, 400)
        self.assertIn("l’un des siens", friendly_fire.get_json()["error"])
        self.assertEqual(self.submit(code, 0, {"target": 2}).status_code, 200)

        friendly_conversion = self.submit(code, 1, {"target": 0})
        self.assertEqual(friendly_conversion.status_code, 400)
        self.assertIn("l’un des siens", friendly_conversion.get_json()["error"])
        with rooms_lock:
            game = rooms[code]["game"]
            self.assertFalse(game["enraged_used"])
            self.assertIsNone(game["enraged_target"])

    def test_witch_can_spend_each_potion_independently(self):
        poison_code = self.create_started_room()
        self.set_roles(
            poison_code,
            ["loup_garou", "sorciere", "villageois", "villageois", "villageois", "villageois"],
        )
        self.assertEqual(self.submit(poison_code, 0, {"target": 2}).status_code, 200)
        poison = self.submit(poison_code, 1, {"save": "no", "kill_target": 3})
        self.assertEqual(poison.status_code, 200)
        with rooms_lock:
            poison_game = rooms[poison_code]["game"]
            self.assertFalse(poison_game["witch_life_used"])
            self.assertTrue(poison_game["witch_death_used"])
            self.assertEqual(
                {death["name"] for death in poison_game["deaths"]},
                {"Joueur 2", "Joueur 3"},
            )

        save_code = self.create_started_room()
        self.set_roles(
            save_code,
            ["loup_garou", "sorciere", "villageois", "villageois", "villageois", "villageois"],
        )
        self.assertEqual(self.submit(save_code, 0, {"target": 2}).status_code, 200)
        save = self.submit(save_code, 1, {"save": "yes", "kill_target": ""})
        self.assertEqual(save.status_code, 200)
        with rooms_lock:
            save_game = rooms[save_code]["game"]
            self.assertTrue(save_game["witch_life_used"])
            self.assertFalse(save_game["witch_death_used"])
            self.assertEqual(save_game["deaths"], [])

    def test_cupidon_rejects_same_target_then_binds_two_distinct_players(self):
        code = self.create_started_room()
        self.set_roles(
            code,
            ["cupidon", "loup_garou", "villageois", "villageois", "villageois", "villageois"],
        )

        same_target = self.submit(code, 0, {"first_target": 2, "second_target": 2})
        self.assertEqual(same_target.status_code, 400)
        with rooms_lock:
            self.assertIsNone(rooms[code]["game"]["lovers"])

        valid_pair = self.submit(code, 0, {"first_target": 2, "second_target": 3})
        self.assertEqual(valid_pair.status_code, 200)
        with rooms_lock:
            self.assertEqual(rooms[code]["game"]["lovers"], [2, 3])

    def test_same_camp_lovers_keep_their_camp_victory(self):
        scenarios = [
            ("village", ["villageois", "voyante"], "village"),
            ("meute", ["loup_garou", "loup_enrage"], "meute"),
        ]
        for camp, lover_roles, expected in scenarios:
            with self.subTest(camp=camp):
                players = [
                    {"name": f"Joueur {index}", "role": role, "alive": index < 2}
                    for index, role in enumerate(lover_roles + ["villageois"] * 4)
                ]
                room = {"players": players}
                initialize_game(room)
                for player in room["players"][2:]:
                    player["alive"] = False
                room["game"]["lovers"] = [0, 1]
                self.assertEqual(check_winners(room), [expected])

    def test_default_compositions_complete_two_noop_rounds_for_every_player_count(self):
        for player_count in range(MIN_PLAYERS, 15):
            with self.subTest(player_count=player_count):
                with rooms_lock:
                    rooms.clear()
                client = app.test_client()
                created = client.post(
                    "/api/rooms",
                    json={
                        "mode": "local",
                        "players": [f"Test {index}" for index in range(player_count)],
                    },
                )
                self.assertEqual(created.status_code, 201)
                code = created.get_json()["code"]
                started = client.post(f"/api/rooms/{code}/start", json={})
                self.assertEqual(started.status_code, 200)
                with rooms_lock:
                    rooms[code]["local_named_indices"] = set(range(player_count))
                    rooms[code]["local_role_viewed_indices"] = set(range(player_count))
                begun = client.post(f"/api/rooms/{code}/game/begin", json={})
                self.assertEqual(begun.status_code, 200)

                for expected_round in (1, 2):
                    for _ in range(player_count * 3):
                        room_view = client.get(f"/api/rooms/{code}").get_json()
                        state = room_view["game"]
                        if state["phase"] == "day":
                            break
                        self.assertEqual(state["phase"], "night")
                        self.assertIsNotNone(state["current_actor"])
                        actor_index = next(
                            index for index, player in enumerate(room_view["players"])
                            if player["name"] == state["current_actor"]
                        )
                        skipped = client.post(
                            f"/api/rooms/{code}/game/action",
                            json={"player_index": actor_index, "do_nothing": True},
                        )
                        self.assertEqual(skipped.status_code, 200, skipped.get_json())
                    else:
                        self.fail(f"La nuit {expected_round} ne s’est pas terminée")

                    day_view = client.get(f"/api/rooms/{code}").get_json()
                    self.assertEqual(day_view["game"]["phase"], "day")
                    self.assertEqual(day_view["game"]["round"], expected_round)
                    for player_index in range(player_count):
                        abstained = client.post(
                            f"/api/rooms/{code}/game/action",
                            json={"player_index": player_index, "target": ""},
                        )
                        self.assertEqual(abstained.status_code, 200, abstained.get_json())

                    next_round = client.get(f"/api/rooms/{code}").get_json()["game"]
                    self.assertEqual(next_round["phase"], "night")
                    self.assertEqual(next_round["round"], expected_round + 1)


if __name__ == "__main__":
    unittest.main()
