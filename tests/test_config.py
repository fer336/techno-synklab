import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config  # noqa: E402


class ParseTests(unittest.TestCase):
    def test_key_value_lines_comments_quotes_and_export(self):
        text = "# comment\n\nA=1\nexport B = two\nC=\"quoted value\"\nD='single'\nE=with=equals\nnot a pair\n"
        self.assertEqual(config.parse(text), {"A": "1", "B": "two", "C": "quoted value", "D": "single", "E": "with=equals"})


class LoadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env_file = Path(self.tmp.name) / ".env"
        self.secret = Path(self.tmp.name) / "techno_synklab_env"

    def test_dotenv_is_used_when_no_secret_exists(self):
        self.env_file.write_text("SYNK_TEST_A=from-env-file\n")
        with mock.patch.dict(os.environ, {}, clear=False), mock.patch.object(config, "secret_path", return_value=self.secret):
            os.environ.pop("SYNK_TEST_A", None)
            used = config.load(self.env_file)
            self.assertEqual(used, self.env_file)
            self.assertEqual(os.environ["SYNK_TEST_A"], "from-env-file")
            os.environ.pop("SYNK_TEST_A", None)

    def test_secret_wins_over_dotenv_and_process_env_wins_over_both(self):
        self.env_file.write_text("SYNK_TEST_A=env-file\nSYNK_TEST_B=env-file\n")
        self.secret.write_text("SYNK_TEST_A=secret\nSYNK_TEST_B=secret\n")
        with mock.patch.dict(os.environ, {"SYNK_TEST_B": "process"}), mock.patch.object(config, "secret_path", return_value=self.secret):
            os.environ.pop("SYNK_TEST_A", None)
            used = config.load(self.env_file)
            self.assertEqual(used, self.secret)
            self.assertEqual(os.environ["SYNK_TEST_A"], "secret")
            self.assertEqual(os.environ["SYNK_TEST_B"], "process")
            os.environ.pop("SYNK_TEST_A", None)

    def test_a_utf8_bom_does_not_swallow_the_first_key(self):
        self.secret.write_bytes(b"\xef\xbb\xbfSYNK_TEST_BOM=ok\r\nSYNK_TEST_NEXT=1\r\n")
        with mock.patch.object(config, "secret_path", return_value=self.secret):
            os.environ.pop("SYNK_TEST_BOM", None)
            config.load(self.env_file)
            self.assertEqual(os.environ.get("SYNK_TEST_BOM"), "ok")
            os.environ.pop("SYNK_TEST_BOM", None)
            os.environ.pop("SYNK_TEST_NEXT", None)

    def test_missing_files_are_not_an_error(self):
        with mock.patch.object(config, "secret_path", return_value=self.secret):
            self.assertIsNone(config.load(Path(self.tmp.name) / "absent.env"))


class ValidateTests(unittest.TestCase):
    def test_development_never_fails(self):
        with mock.patch.dict(os.environ, {"APP_ENV": "development"}):
            os.environ.pop("MUSICBRAINZ_USER_AGENT", None)
            config.validate()

    def test_production_requires_a_real_contact(self):
        with mock.patch.dict(os.environ, {"APP_ENV": "production"}):
            os.environ.pop("MUSICBRAINZ_USER_AGENT", None)
            with self.assertRaises(SystemExit) as missing:
                config.validate()
            self.assertIn("MUSICBRAINZ_USER_AGENT", str(missing.exception))
            os.environ["MUSICBRAINZ_USER_AGENT"] = "SynkLab/0.2 (tu-contacto@example.com)"
            with self.assertRaises(SystemExit) as placeholder:
                config.validate()
            self.assertIn("placeholder", str(placeholder.exception))
            os.environ["MUSICBRAINZ_USER_AGENT"] = "SynkLab/0.2 (ops@qeva-ai.com)"
            config.validate()

    def test_error_message_never_contains_the_value(self):
        secret_value = "SynkLab/0.2 (private@example.org)"
        with mock.patch.dict(os.environ, {"APP_ENV": "production", "MUSICBRAINZ_USER_AGENT": secret_value}):
            with self.assertRaises(SystemExit) as err:
                config.validate()
            self.assertNotIn("private@example.org", str(err.exception))


class VersionEndpointTests(unittest.TestCase):
    @unittest.skipUnless(__import__("importlib.util").util.find_spec("fastapi"), "fastapi not installed")
    def test_health_and_version(self):
        with mock.patch.dict(os.environ, {"APP_VERSION": "v9.9.9", "APP_ENV": "development"}):
            sys.modules.pop("server", None)
            from fastapi.testclient import TestClient
            import server
            client = TestClient(server.app)
            health = client.get("/health")
            self.assertEqual((health.status_code, health.json()), (200, {"status": "ok"}))
            version = client.get("/version")
            self.assertEqual((version.status_code, version.json()), (200, {"version": "v9.9.9"}))
            sys.modules.pop("server", None)


if __name__ == "__main__":
    unittest.main()
