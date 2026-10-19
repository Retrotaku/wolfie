import unittest

from Wolfie.app import (
    MIN_PLAYERS,
    ROLE_CARDS,
    app,
    clean_name,
    composition_counts,
    default_composition,
    rooms,
    rooms_lock,
    validate_composition,
)


class CompositionTests(unittest.TestCase):
    def test_default_distribution_for_each_supported_player_count(self):
        expected = {
            6: (2, 2, 2),
            7: (2, 2, 3),
            8: (2, 3, 3),
            9: (3, 3, 3),
            10: (3, 3, 4),
            11: (3, 4, 4),
            12: (4, 4, 4),
            13: (4, 4, 5),
            14: (4, 5, 5),
        }
        for player_count, (specials, wolves, villagers) in expected.items():
            with self.subTest(player_count=player_count):
                composition = default_composition(player_count)
                self.assertIsNotNone(composition)
                counts = composition_counts(player_count, composition)
                self.assertEqual(counts["special_count"], specials)
                self.assertEqual(counts["wolf_count"], wolves)
                self.assertEqual(counts["villager_count"], villagers)

    def test_default_special_wolves_replace_regular_wolves(self):
        self.assertEqual(default_composition(8)["wolf_roles"], [])
        self.assertEqual(default_composition(9)["wolf_roles"], ["loup_enrage"])
        self.assertEqual(
            default_composition(12)["wolf_roles"], ["loup_enrage", "loup_blanc"]
        )

    def test_composition_rejects_duplicate_roles_and_excess_wolf_variants(self):
        with self.assertRaises(ValueError):
            validate_composition(
                {"special_roles": ["voyante", "voyante"], "wolf_roles": []}, 6
            )
        with self.assertRaises(ValueError):
            validate_composition(
                {
                    "special_roles": ["voyante", "sorciere", "cupidon", "chasseur"],
                    "wolf_roles": ["loup_enrage", "loup_blanc"],
                },
                6,
            )

    def test_composition_rejects_unknown_roles(self):
        with self.assertRaises(ValueError):
            validate_composition(
                {"special_roles": ["villageois"], "wolf_roles": []}, 6
            )


class PlayerNameTests(unittest.TestCase):
    def test_name_is_trimmed_and_first_character_capitalized(self):
        self.assertEqual(clean_name("  alice  "), "Alice")
        self.assertEqual(clean_name("éloi"), "Éloi")

    def test_name_is_limited_to_ten_characters(self):
        self.assertEqual(clean_name("abcdefghij"), "Abcdefghij")
        with self.assertRaisesRegex(ValueError, "10 caractères"):
            clean_name("abcdefghijk")
        with self.assertRaisesRegex(ValueError, "vide"):
            clean_name("   ")


class RoleRouteTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="test-secret")
        self.client = app.test_client()

    def tearDown(self):
        with rooms_lock:
            rooms.clear()

    def test_role_back_and_profile_assets_are_served(self):
        back = self.client.get("/resources/cartes/Dos_carte.jpeg")
        profile = self.client.get("/resources/icone_profil.jpeg")
        self.assertEqual(back.status_code, 200)
        self.assertEqual(profile.status_code, 200)
        self.assertTrue(back.content_type.startswith("image/"))
        self.assertTrue(profile.content_type.startswith("image/"))

    def test_online_players_only_receive_their_own_role(self):
        host = self.client
        response = host.post(
            "/api/rooms", json={"mode": "online", "name": "Hote"}
        )
        self.assertEqual(response.status_code, 201)
        room = response.get_json()
        code = room["code"]
        clients = [host]

        for index in range(MIN_PLAYERS - 1):
            client = app.test_client()
            joined = client.post(
                "/api/rooms/join",
                json={"code": code, "name": f"Joueur {index + 1}"},
            )
            self.assertEqual(joined.status_code, 200)
            clients.append(client)

        not_ready = host.post(f"/api/rooms/{code}/start", json={})
        self.assertEqual(not_ready.status_code, 409)
        self.assertIn("prêts", not_ready.get_json()["error"])

        for client in clients:
            ready = client.post(f"/api/rooms/{code}/ready", json={"ready": True})
            self.assertEqual(ready.status_code, 200)

        with rooms_lock:
            rooms[code]["players"][0]["last_seen"] = 0
        host_absent = host.post(f"/api/rooms/{code}/start", json={})
        self.assertEqual(host_absent.status_code, 409)
        self.assertIn("hôte", host_absent.get_json()["error"])
        host.get(f"/api/rooms/{code}")

        started = host.post(f"/api/rooms/{code}/start", json={})
        self.assertEqual(started.status_code, 200)
        public_room = started.get_json()
        self.assertNotIn("role", public_room)
        self.assertTrue(all("role" not in player for player in public_room["players"]))

        assigned_roles = []
        for client in clients:
            role_response = client.get(f"/api/rooms/{code}/role")
            self.assertEqual(role_response.status_code, 200)
            role = role_response.get_json()
            self.assertIn(role["name"], {details[0] for details in ROLE_CARDS.values()})
            self.assertIsNone(role["player_name"])
            assigned_roles.append(role["name"])
            view = client.get(f"/api/rooms/{code}").get_json()
            self.assertTrue(all("role" not in player for player in view["players"]))

        self.assertEqual(len(assigned_roles), MIN_PLAYERS)

    def test_leaving_keeps_room_and_player_can_rejoin_before_start(self):
        host = self.client
        created = host.post("/api/rooms", json={"mode": "online", "name": "Hote"})
        self.assertEqual(created.status_code, 201)
        code = created.get_json()["code"]

        left = host.post(f"/api/rooms/{code}/leave", json={})
        self.assertEqual(left.status_code, 200)
        self.assertIn(code, rooms)

        returned = host.post(
            "/api/rooms/join", json={"code": code, "name": "Hote"}
        )
        self.assertEqual(returned.status_code, 200)
        self.assertTrue(returned.get_json()["is_host"])
        self.assertEqual(returned.get_json()["player_count"], 1)

    def test_joining_a_started_room_reports_game_in_progress(self):
        host = self.client
        created = host.post("/api/rooms", json={"mode": "online", "name": "Hote"})
        code = created.get_json()["code"]
        guest = app.test_client()
        for index in range(MIN_PLAYERS - 1):
            joined = guest.post(
                "/api/rooms/join",
                json={"code": code, "name": f"Joueur {index}"},
            )
            self.assertEqual(joined.status_code, 200)
            ready = guest.post(f"/api/rooms/{code}/ready", json={"ready": True})
            self.assertEqual(ready.status_code, 200)
            if index < MIN_PLAYERS - 2:
                guest = app.test_client()
        host.post(f"/api/rooms/{code}/ready", json={"ready": True})
        started = host.post(f"/api/rooms/{code}/start", json={})
        self.assertEqual(started.status_code, 200)

        late_player = app.test_client()
        late = late_player.post(
            "/api/rooms/join", json={"code": code, "name": "Arrivant"}
        )
        self.assertEqual(late.status_code, 409)
        self.assertEqual(late.get_json()["error"], "Une partie est en cours.")

    def test_local_role_route_requires_host_and_valid_player_index(self):
        create_response = self.client.post(
            "/api/rooms",
            json={"mode": "local", "players": [f"Joueur {index}" for index in range(MIN_PLAYERS)]},
        )
        self.assertEqual(create_response.status_code, 201)
        created_code = create_response.get_json()["code"]
        start_response = self.client.post(f"/api/rooms/{created_code}/start", json={})
        self.assertEqual(start_response.status_code, 200)

        premature_role = self.client.get(
            f"/api/rooms/{created_code}/role?player_index=0"
        )
        self.assertEqual(premature_role.status_code, 409)

        first_name = self.client.post(
            f"/api/rooms/{created_code}/players/0/name",
            json={"name": "Lune"},
        )
        self.assertEqual(first_name.status_code, 200)
        self.assertEqual(first_name.get_json()["local_named_indices"], [0])

        another_slot = self.client.post(
            f"/api/rooms/{created_code}/players/4/name",
            json={"name": "Noa"},
        )
        self.assertEqual(another_slot.status_code, 200)
        self.assertEqual(another_slot.get_json()["local_named_indices"], [0, 4])

        reused_slot = self.client.post(
            f"/api/rooms/{created_code}/players/0/name",
            json={"name": "Lune bis"},
        )
        self.assertEqual(reused_slot.status_code, 409)

        role_response = self.client.get(
            f"/api/rooms/{created_code}/role?player_index=0"
        )
        self.assertEqual(role_response.status_code, 200)
        self.assertEqual(role_response.get_json()["player_name"], "Lune")
        self.assertEqual(
            self.client.get(f"/api/rooms/{created_code}").get_json()["local_role_viewed_indices"],
            [0],
        )

        other_role = self.client.get(
            f"/api/rooms/{created_code}/role?player_index=4"
        )
        self.assertEqual(other_role.status_code, 200)
        self.assertEqual(other_role.get_json()["player_name"], "Noa")

        duplicate_name = self.client.post(
            f"/api/rooms/{created_code}/players/1/name",
            json={"name": "Lune"},
        )
        self.assertEqual(duplicate_name.status_code, 400)

        duplicate_name = self.client.post(
            f"/api/rooms/{created_code}/players/1/name",
            json={"name": "Noa"},
        )
        self.assertEqual(duplicate_name.status_code, 400)

        invalid_index = self.client.get(
            f"/api/rooms/{created_code}/role?player_index={MIN_PLAYERS}"
        )
        self.assertEqual(invalid_index.status_code, 400)


if __name__ == "__main__":
    unittest.main()
