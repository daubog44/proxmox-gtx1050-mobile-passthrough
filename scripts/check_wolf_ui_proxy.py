#!/usr/bin/env python3
"""Run with python3 scripts/check_wolf_ui_proxy.py; no Wolf/Docker required."""
import importlib.machinery
import importlib.util
import json
import socket
import struct
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader("broker", str(Path(__file__).with_name("omarchy-session-broker")))
broker = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(broker)


class PeerSocket:
    # SO_PEERCRED is Linux-only; emulate the credential lookup on macOS too.
    def __init__(self, sock):
        self.sock = sock

    def getsockopt(self, *_):
        return struct.pack("3i", 1, 0, 0)

    def __getattr__(self, name):
        return getattr(self.sock, name)


profiles = json.dumps({"profiles": [{"id": "own"}, {"id": "other"}]}).encode()
with tempfile.TemporaryDirectory() as directory, ThreadPoolExecutor(max_workers=2) as pool:
    db = Path(directory) / "sessions.db"
    conn = broker.init_db(db)
    creation = {"profile_id":"own","runner":{"name":"WolfXFCE"},"video_settings":{"width":2560,"height":1600}}
    assert broker.get_setting(conn, "desktop_scale") == "1"
    assert broker.adapt_desktop_lobby(conn, json.loads(json.dumps(creation)))["video_settings"] == {"width":2560,"height":1600}
    broker.set_setting(conn, "desktop_scale", "1.25")
    assert broker.adapt_desktop_lobby(conn, json.loads(json.dumps(creation)))["video_settings"] == {"width":2048,"height":1280}
    broker.set_setting(conn, "desktop_scale", "1")
    conn.close()
    path = str(Path(directory) / "wolf.sock")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.bind(path)
        server.listen()
        server.settimeout(2)
        with (patch.object(broker, "DEFAULT_WOLF_SOCKET", path),
              patch.object(broker.socket, "SO_PEERCRED", 17, create=True),
              patch.object(broker, "wolf_ui_session_of_pid", return_value="test"),
              patch.object(broker, "wolf_profile_for_session", return_value="own")):
            for endpoint, body, stream in [("profiles", profiles, False), ("lobbies", b'{"lobbies":[]}', False),
                                            ("events", b"event: ready\ndata: {}\n\n", True), ("lobbies/create", b'{"lobby_id":"new"}', False)]:
                request = f"GET /api/v1/{endpoint} HTTP/1.1\r\nHost: localhost\r\n\r\n".encode()

                expected = request
                if endpoint == "lobbies/create":
                    payload = json.dumps(creation).encode()
                    request = b"POST /api/v1/lobbies/create HTTP/1.1\r\nHost: localhost\r\nContent-Length: " + str(len(payload)).encode() + b"\r\n\r\n" + payload
                    adapted = json.loads(json.dumps(creation))
                    payload = json.dumps(adapted).encode()
                    expected = b"POST /api/v1/lobbies/create HTTP/1.1\r\nHost: localhost\r\nContent-Length: " + str(len(payload)).encode() + b"\r\n\r\n" + payload

                def backend():
                    upstream, _ = server.accept()
                    with upstream:
                        upstream.settimeout(2)
                        assert broker._read_http_head(upstream) == expected
                        header = (b"Content-Type: text/event-stream" if stream else
                                  b"Content-Length: " + str(len(body)).encode())
                        upstream.sendall(b"HTTP/1.0 200 OK\r\n" + header + b"\r\n\r\n" + body)

                backend_task = pool.submit(backend)
                client, proxy = socket.socketpair()
                proxy_task = pool.submit(broker._serve_wolf_ui_client, PeerSocket(proxy), str(db))
                with client:
                    client.settimeout(2)
                    client.sendall(request)
                    response = b""
                    while chunk := client.recv(4096):
                        response += chunk
                backend_task.result(timeout=3)
                proxy_task.result(timeout=3)
                headers, received = response.split(b"\r\n\r\n", 1)
                if endpoint == "profiles":
                    assert json.loads(received) == {"profiles": [{"id": "own"}]}
                else:
                    assert received == body
                if not stream:
                    assert broker._content_length(headers) == len(received)
                    assert b"Connection: close" in headers
print("Wolf UI proxy: chiusura HTTP, filtro profili ed eventi OK")
