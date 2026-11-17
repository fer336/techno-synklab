import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import netguard  # noqa: E402


class LocalClientTests(unittest.TestCase):
    def test_loopback_is_always_local(self):
        for host in ("127.0.0.1", "::1", "localhost"):
            with mock.patch.dict(os.environ, {"SYNKLAB_IN_CONTAINER": ""}):
                self.assertTrue(netguard.is_local_client(host))

    def test_private_addresses_are_rejected_outside_a_container(self):
        with mock.patch.dict(os.environ, {"SYNKLAB_IN_CONTAINER": ""}):
            for host in ("172.17.0.1", "192.168.1.20", "10.0.0.5"):
                self.assertFalse(netguard.is_local_client(host), host)

    def test_private_addresses_pass_inside_a_container(self):
        with mock.patch.dict(os.environ, {"SYNKLAB_IN_CONTAINER": "1"}):
            for host in ("172.17.0.1", "192.168.65.1", "10.0.0.5"):
                self.assertTrue(netguard.is_local_client(host), host)

    def test_public_and_garbage_addresses_are_rejected_everywhere(self):
        for flag in ("", "1"):
            with mock.patch.dict(os.environ, {"SYNKLAB_IN_CONTAINER": flag}):
                for host in ("8.8.8.8", "2606:4700:4700::1111", "evil.example", "", "0.0.0.0"):
                    self.assertFalse(netguard.is_local_client(host), (flag, host))


class HostHeaderTests(unittest.TestCase):
    def test_local_host_headers(self):
        for raw in ("localhost:8000", "127.0.0.1:8000", "[::1]:8000", "localhost", "LOCALHOST:8000", "localhost.:8000"):
            self.assertTrue(netguard.is_local_host_header(raw), raw)

    def test_foreign_host_headers(self):
        for raw in ("evil.example:8000", "192.168.1.20:8000", "localhost.evil.example", "user@localhost:80", "", None):
            self.assertFalse(netguard.is_local_host_header(raw), raw)


if __name__ == "__main__":
    unittest.main()
