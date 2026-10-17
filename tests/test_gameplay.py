import unittest

from Wolfie.app import (
    MIN_PLAYERS,
    app,
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
