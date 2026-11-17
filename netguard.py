"""Shared "is this request local?" checks for the local-only endpoints (agent control, downloads).

Outside a container only loopback clients pass. Inside the official Docker image (SYNKLAB_IN_CONTAINER=1)
the browser reaches the app through Docker's bridge, so the client appears with a private address such as
172.17.0.1; those are accepted too. The image must then be published on the host's loopback only
(``-p 127.0.0.1:8000:8000``), and requests must still carry a localhost ``Host`` header.

Limits: the Host header only stops browser-based DNS rebinding (other clients can forge it), and any container on the
same Docker network can reach the app. Do not publish the port beyond 127.0.0.1 or share its network with untrusted containers.
"""
from __future__ import annotations

import ipaddress
import os

LOOPBACK = {"127.0.0.1", "::1", "localhost"}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def in_container() -> bool:
    return os.environ.get("SYNKLAB_IN_CONTAINER") == "1"


def is_loopback_client(host: str) -> bool:
    return host in LOOPBACK


def is_local_client(host: str) -> bool:
    if host in LOOPBACK:
        return True
    if not in_container():
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private and not ip.is_unspecified


def host_header_name(raw: str | None) -> str:
    raw = (raw or "").strip().lower()
    name = raw[1:raw.index("]")] if raw.startswith("[") and "]" in raw else raw.rsplit(":", 1)[0]
    return name.rstrip(".")


def is_local_host_header(raw: str | None) -> bool:
    return host_header_name(raw) in LOCAL_HOSTS
