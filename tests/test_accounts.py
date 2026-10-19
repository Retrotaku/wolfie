import os
import unittest
from unittest.mock import patch

from app import account_sessions, account_sessions_lock, app


SUPABASE_ENV = {
    "SUPABASE_URL": "https://wolfie-test.supabase.co",
    "SUPABASE_ANON_KEY": "test-anon-key",
}


class AccountRouteTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True, SECRET_KEY="account-test-secret")
        self.client = app.test_client()
        with account_sessions_lock:
            account_sessions.clear()

    def tearDown(self):
        with account_sessions_lock:
            account_sessions.clear()

    def test_homepage_exposes_account_and_profile_forms(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'id="account-toggle"', response.data)
        self.assertIn(b'id="account-auth-form"', response.data)
        self.assertIn(b'id="account-profile-form"', response.data)

    def test_signup_reports_missing_supabase_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            response = self.client.post(
                "/api/account/signup",
                json={
                    "email": "joueur@example.com",
                    "password": "motdepasse123",
                    "display_name": "Lune",
                },
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("SUPABASE_URL", response.get_json()["error"])

    def test_signup_requires_email_confirmation_when_supabase_has_no_session(self):
        with (
            patch.dict(os.environ, SUPABASE_ENV),
            patch(
                "app.supabase_request",
                return_value={"user": {"id": "user-1", "email": "joueur@example.com"}},
            ),
        ):
            response = self.client.post(
                "/api/account/signup",
                json={
                    "email": "Joueur@example.com",
                    "password": "motdepasse123",
                    "display_name": "lune",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.get_json()["requires_confirmation"])
        self.assertEqual(
            response.get_json()["message"],
            "Compte créé. Vérifie ta boîte mail pour confirmer ton adresse avant de te connecter.",
        )

    def test_signup_accepts_supabase_auth_response_with_root_user_fields(self):
        auth_response = {
            "id": "user-1",
            "email": "joueur@example.com",
            "access_token": "user-access-token",
            "refresh_token": "user-refresh-token",
            "expires_in": 3600,
        }
        profile = {"id": "user-1", "display_name": "Lune", "bio": ""}
        with (
            patch.dict(os.environ, SUPABASE_ENV),
            patch("app.supabase_request", side_effect=[auth_response, [profile]]),
        ):
            response = self.client.post(
                "/api/account/signup",
                json={
                    "email": "joueur@example.com",
                    "password": "motdepasse123",
                    "display_name": "Lune",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["account"]["profile"], profile)

    def test_signup_stores_private_session_and_returns_profile(self):
        auth_response = {
            "access_token": "user-access-token",
            "refresh_token": "user-refresh-token",
            "expires_in": 3600,
            "user": {"id": "user-1", "email": "joueur@example.com"},
        }
        profile = {"id": "user-1", "display_name": "Lune", "bio": ""}
        with (
            patch.dict(os.environ, SUPABASE_ENV),
            patch("app.supabase_request", side_effect=[auth_response, [profile]]) as request,
        ):
            response = self.client.post(
                "/api/account/signup",
                json={
                    "email": "Joueur@example.com",
                    "password": "motdepasse123",
                    "display_name": "lune",
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["account"]["profile"], profile)
        self.assertEqual(request.call_args_list[0].kwargs["payload"]["data"]["display_name"], "Lune")
        with self.client.session_transaction() as browser_session:
            session_id = browser_session["account_session_id"]
        self.assertNotIn("user-access-token", self.client.get_cookie(app.config["SESSION_COOKIE_NAME"]).value)
        self.assertEqual(account_sessions[session_id]["access_token"], "user-access-token")

    def test_profile_updates_are_validated_and_preserve_game_session(self):
        account_session_id = "opaque-account-session"
        with account_sessions_lock:
            account_sessions[account_session_id] = {
                "id": "user-1",
                "email": "joueur@example.com",
                "access_token": "user-access-token",
                "refresh_token": "user-refresh-token",
                "expires_at": 9999999999,
            }
        with self.client.session_transaction() as browser_session:
            browser_session["account_session_id"] = account_session_id
            browser_session["room_code"] = "ABC123"
            browser_session["player_id"] = "game-player-id"

        with patch.dict(os.environ, SUPABASE_ENV), patch("app.supabase_request") as request:
            too_long = self.client.patch(
                "/api/account/profile",
                json={"display_name": "abcdefghijkl", "bio": ""},
            )
            oversized_bio = self.client.patch(
                "/api/account/profile",
                json={"display_name": "Lune", "bio": "x" * 281},
            )
            request.assert_not_called()
            request.return_value = [
                {"id": "user-1", "display_name": "Lune", "bio": "Bonjour"}
            ]
            updated = self.client.patch(
                "/api/account/profile",
                json={"display_name": "lune", "bio": "  Bonjour  "},
            )

        self.assertEqual(too_long.status_code, 400)
        self.assertEqual(oversized_bio.status_code, 400)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(
            request.call_args.kwargs["payload"],
            {"display_name": "Lune", "bio": "Bonjour"},
        )
        with self.client.session_transaction() as browser_session:
            self.assertEqual(browser_session["room_code"], "ABC123")
            self.assertEqual(browser_session["player_id"], "game-player-id")

    def test_logout_removes_account_session_without_leaving_game_room(self):
        account_session_id = "opaque-account-session"
        with account_sessions_lock:
            account_sessions[account_session_id] = {"id": "user-1"}
        with self.client.session_transaction() as browser_session:
            browser_session["account_session_id"] = account_session_id
            browser_session["room_code"] = "ABC123"
            browser_session["player_id"] = "game-player-id"

        response = self.client.post("/api/account/logout", json={})

        self.assertEqual(response.status_code, 200)
        self.assertNotIn(account_session_id, account_sessions)
        with self.client.session_transaction() as browser_session:
            self.assertNotIn("account_session_id", browser_session)
            self.assertEqual(browser_session["room_code"], "ABC123")
            self.assertEqual(browser_session["player_id"], "game-player-id")


if __name__ == "__main__":
    unittest.main()
