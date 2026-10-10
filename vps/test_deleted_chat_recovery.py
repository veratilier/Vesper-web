import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
import codex_history_server as server
from vesper_browser_body import visible_body, patch_source

class Request:
    path = '/conversations/deleted?latest=1&limit=40'
    def send_json(self, status, value): self.status, self.value = status, value

class RecoveryTests(unittest.TestCase):
    def test_browser_patch_rejects_an_unexpected_source(self):
        with self.assertRaises(ValueError): patch_source('unrelated service')

    def test_pending_source_deletion_is_not_listed_or_misreported_as_missing_route(self):
        with tempfile.TemporaryDirectory() as directory:
            original = server.DB_PATH
            try:
                server.DB_PATH = Path(directory) / 'history.sqlite3'
                with server.db() as db:
                    for room in ('deleted', 'live'):
                        db.execute("INSERT INTO conversations VALUES (?,NULL,?, '2026-01-01','2026-01-01',NULL,'codex')",(room, room))
                    server.conversation_delete.block(db, 'deleted', None)
                request = Request()
                server.Handler.list_conversations(request)
                self.assertEqual([x['id'] for x in request.value['conversations']], ['live'])
                server.Handler.get_conversation(request, 'deleted')
                self.assertEqual(request.status, 410)
                self.assertEqual(request.value['code'], 'conversation_deleted')
            finally: server.DB_PATH = original

class BrowserBodyTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_body_allows_existing_screenshot_pipeline_to_continue(self):
        page = AsyncMock()
        page.evaluate.return_value = ''
        self.assertEqual(await visible_body(page), '')
        page.locator.assert_not_called()

    async def test_privacy_inspection_failure_is_not_swallowed(self):
        page = AsyncMock()
        page.evaluate.side_effect = RuntimeError('page closed')
        with self.assertRaises(RuntimeError): await visible_body(page)

if __name__ == '__main__': unittest.main()
