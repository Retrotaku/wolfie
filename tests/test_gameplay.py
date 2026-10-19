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
            ["loup_garou", "villageois", "villageois", "villageois", "villageois", "villageois"],
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
        self.assertEqual(response.get_json()["state"]["round"], 2)
        self.assertEqual(response.get_json()["state"]["alive_players"], [f"Joueur {i}" for i in range(MIN_PLAYERS)])

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

    def test_tied_village_vote_eliminates_no_one_and_starts_next_night(self):
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
        self.assertEqual(state["phase"], "night")
        self.assertEqual(state["round"], 2)
        self.assertEqual(state["deaths"], [])
        self.assertEqual(len(state["alive_players"]), MIN_PLAYERS)

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


if __name__ == "__main__":
    unittest.main()
