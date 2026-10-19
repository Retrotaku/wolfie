import unittest

from Wolfie.app import app


class ModeNavigationTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="navigation-test-secret")
        self.client = app.test_client()

    def test_home_is_a_dedicated_mode_selection_page(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"Le village", response.data)
        self.assertIn(b"href=\"/local\"", response.data)
        self.assertIn(b"href=\"/online\"", response.data)
        self.assertIn(b"data-start-mode=\"\"", response.data)
        self.assertIn(b'id="intro-skip"', response.data)

    def test_local_and_online_modes_open_on_their_own_setup_pages(self):
        local = self.client.get("/local")
        online = self.client.get("/online")

        self.assertEqual(local.status_code, 200)
        self.assertIn(b"data-start-mode=\"local\"", local.data)
        self.assertIn(b"Rassemble le village", local.data)
        self.assertIn(b"Combien de joueurs ?", local.data)
        self.assertIn(b"href=\"/\"", local.data)

        self.assertEqual(online.status_code, 200)
        self.assertIn(b"data-start-mode=\"online\"", online.data)
        self.assertIn(b"La meute se rassemble", online.data)
        self.assertIn(b"create-online-form", online.data)
        self.assertIn(b"join-form", online.data)
        self.assertIn(b"href=\"/\"", online.data)

    def test_card_back_asset_uses_the_existing_filename_case(self):
        response = self.client.get("/resources/cartes/dos_carte.jpeg")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/jpeg")
        response.close()
