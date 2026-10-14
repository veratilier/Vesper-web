#!/usr/bin/env python3
"""Authenticated SQLite history API colocated with the Vesper Codex app-server."""

from __future__ import annotations

import hmac
import time
import uuid
from types import SimpleNamespace
from vesper_backend import router
from vesper_backend.adapters import chat_endpoint
from vesper_backend.contracts import now, is_internal_context, valid_history_attachment, valid_history_batch, conversation, message, INTERNAL_CONTEXT_PREFIXES
from vesper_backend.storage import SCHEMA, open_history
import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse, parse_qs
import vesper_activity as activity
import vesper_wake_store as wake_store
import vesper_conversation_delete as conversation_delete
import vesper_watch as watch
import vesper_terminal as terminal
import vesper_codex_records as codex_records
import vesper_music_search as music_search
import vesper_chat_screenshot as chat_screenshot
import vesper_companion_poke as companion_poke
import vesper_bark as bark
import vesper_screen_companion as screen_companion
import vesper_generated_images as generated_images


DB_PATH = Path(os.environ.get("VESPER_HISTORY_DB", "/home/ubuntu/.vesper/chat-history.sqlite3"))
TOKEN_PATH = Path(os.environ.get("CODEX_TOKEN_FILE", "/home/ubuntu/.codex/app-server-token"))
ALLOWED_ORIGINS = {"https://vesper.r-vera.com", "http://localhost:3000", "http://localhost:5173"}


def db() -> sqlite3.Connection:
    return open_history(DB_PATH, SCHEMA)


class Handler(BaseHTTPRequestHandler):
    server_version = "VesperHistory/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        # Request diagnostics are emitted once by dispatch, without URLs or contents.
        if not getattr(self, "request_id", None):
            print(f"Vesper gateway {self.command}")

    def origin(self) -> str | None:
        value = self.headers.get("Origin")
        return value if value in ALLOWED_ORIGINS else None

    def authenticated(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        supplied = supplied[7:].strip() if supplied.startswith("Bearer ") else ""
        try:
            expected = TOKEN_PATH.read_text(encoding="utf-8").strip()
        except OSError:
            return False
        return bool(supplied and expected and hmac.compare_digest(supplied, expected))

    def send_json(self, status: int, value: object) -> None:
        if getattr(self, "defer_json", False):
            self.pending_json = (status, value)
            return
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        if getattr(self, "request_id", None): self.send_header("X-Vesper-Request-ID", self.request_id)
        origin = self.origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        if not self.origin():
            self.send_json(403, {"error": "Origin not allowed"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.origin() or "")
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def watch_secret(self):
        return TOKEN_PATH.read_text(encoding="utf-8").strip()

    def send_response(self, code, message=None):
        self.response_status = code
        super().send_response(code, message)

    def dispatch(self) -> None:
        self.request_id = uuid.uuid4().hex
        self.service_name = 'gateway'
        started = time.monotonic()
        self.defer_json = True
        self.pending_json = None
        error_class = None
        try:
            self.dispatch_request()
        except (ValueError, UnicodeDecodeError) as error:
            error_class = type(error).__name__
            self.pending_json = (400, {'error': 'Invalid request body'})
        except sqlite3.Error as error:
            error_class = type(error).__name__
            self.pending_json = (503, {'error': 'History storage unavailable; operation not confirmed'})
        except (BrokenPipeError, ConnectionResetError):
            self.pending_json = None
        except Exception as error:
            error_class = type(error).__name__
            self.pending_json = (500, {'error': 'Backend operation failed; completion not confirmed'})
        finally:
            # Every database context has committed or rolled back before success goes out.
            self.defer_json = False
            if self.pending_json is not None:
                try: self.send_json(*self.pending_json)
                except (BrokenPipeError, ConnectionResetError): pass
            print(json.dumps({'event': 'api_request', 'service': self.service_name,
                'method': self.command, 'status': getattr(self, 'response_status', 500),
                'requestId': self.request_id, 'elapsedMs': round((time.monotonic() - started) * 1000),
                'errorClass': error_class}, separators=(',', ':')))

    @property
    def services(self):
        # Resolve late so runners/tests and configured adapters use the same database.
        return SimpleNamespace(activity=activity, bark=bark, chat_screenshot=chat_screenshot, codex_records=codex_records, companion_poke=companion_poke, conversation=conversation, conversation_delete=conversation_delete, db=db, generated_images=generated_images, is_internal_context=is_internal_context, message=message, music_search=music_search, now=now, screen_companion=screen_companion, terminal=terminal, valid_history_attachment=valid_history_attachment, valid_history_batch=valid_history_batch, wake_store=wake_store, watch=watch)

    def dispatch_request(self) -> None:
        parts = urlparse(self.path).path.strip('/').split('/')
        if router.public(self, parts, self.services): return
        if not self.authenticated():
            self.send_json(401, {'error': 'Unauthorized'}); return
        path = [unquote(part) for part in parts if part]
        router.dispatch(self, path, self.services)

    def body(self) -> dict:
        length = min(int(self.headers.get("Content-Length", "0") or 0), 1_000_000)
        value = json.loads(self.rfile.read(length) or b"{}")
        if not isinstance(value, dict):
            raise ValueError("JSON object required")
        return value


    conversation_terminal = chat_endpoint("conversation_terminal")
    inbox = chat_endpoint("inbox")
    list_conversations = chat_endpoint("list_conversations")
    search_messages = chat_endpoint("search_messages")
    get_conversation = chat_endpoint("get_conversation")
    upsert_conversation = chat_endpoint("upsert_conversation")
    upsert_message = chat_endpoint("upsert_message")
    delete_conversation = chat_endpoint("delete_conversation")
    delete_message = chat_endpoint("delete_message")

    do_GET = dispatch
    do_POST = dispatch
    do_PATCH = dispatch
    do_DELETE = dispatch


if __name__ == "__main__":
    with db():
        pass
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("VESPER_HISTORY_PORT", "4510"))), Handler)
    companion_poke.start(db, recover=True)
    screen_companion.start(db)
    watch.start_cleanup()
    bark.start(db, lambda: TOKEN_PATH.read_text().strip())
    server.serve_forever()
