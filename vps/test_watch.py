import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import vesper_watch as w

class WatchTests(unittest.TestCase):
    def test_only_bilibili_playback_urls(self):
        self.assertEqual(w.canonical('https://www.bilibili.com/video/BV1abc?p=2&foo=secret'), 'https://www.bilibili.com/video/BV1abc?p=2')
        for url in ['http://www.bilibili.com/video/BV1abc', 'https://127.0.0.1/video/BV1abc', 'https://www.bilibili.com.evil.test/video/BV1abc', 'https://user@www.bilibili.com/video/BV1abc', 'https://www.bilibili.com/redirect', 'https://www.bilibili.com/video/BV1abc?p=0']:
            with self.assertRaises(ValueError): w.canonical(url)
    def test_repeat_link_reuses_ready_private_import(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(w, 'ROOT', Path(tmp)), patch.object(w.threading, 'Thread') as thread:
            ident='c'*32;path=w.folder(ident);path.mkdir();(path/'media.mp4').write_bytes(b'fixture')
            url=w.canonical('https://www.bilibili.com/video/BV1abc/')
            w.save(path,{'id':ident,'status':'ready','created':w.time.time(),'sourceHash':w.hashlib.sha256(url.encode()).hexdigest()})
            self.assertEqual(w.start(url+'&tracking=ignored'),{'id':ident,'status':'ready'})
            thread.assert_not_called()

    def test_range_for_seeking(self):
        self.assertEqual(w.byte_range(None, 100), (0, 99, 200))
        self.assertEqual(w.byte_range('bytes=20-39', 100), (20, 39, 206))
        self.assertEqual(w.byte_range('bytes=-10', 100), (90, 99, 206))
        self.assertEqual(w.byte_range('bytes=50-', 100), (50, 99, 206))
        for value in ['bytes=100-', 'bytes=9-2', 'bytes=-0', 'bytes=0-1,5-9', 'bytes=-']:
            with self.assertRaises(ValueError): w.byte_range(value, 100)
    def test_ticket_scoped_to_video_expiry_and_secret(self):
        base = w.ticket('a', 123, 'secret')
        for args in [('b', 123, 'secret'), ('a', 124, 'secret'), ('a', 123, 'other')]:
            self.assertNotEqual(base, w.ticket(*args))
    def test_expiry_and_interrupted_job(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(w, 'ROOT', Path(tmp)):
            ident = 'a' * 32; path = w.folder(ident); path.mkdir()
            w.save(path, {'status':'preparing', 'created':w.time.time()})
            self.assertEqual(w.read(ident)['status'], 'failed')
            w.save(path, {'status':'ready', 'created':0})
            with self.assertRaises(ValueError): w.read(ident)
            with self.assertRaises(ValueError): w.folder('../secret')

    def test_http_auth_stream_and_cors(self):
        import codex_history_server as history
        from http.server import ThreadingHTTPServer
        from urllib.request import urlopen, Request
        from urllib.error import HTTPError
        import threading
        with tempfile.TemporaryDirectory() as tmp, patch.object(w, 'ROOT', Path(tmp)):
            token = Path(tmp) / 'token'; token.write_text('fixture')
            ident = 'b' * 32; path = w.folder(ident); path.mkdir()
            (path / 'media.mp4').write_bytes(b'0123456789')
            w.save(path, {'status':'ready', 'created':w.time.time()})
            with patch.object(history, 'TOKEN_PATH', token):
                server = ThreadingHTTPServer(('127.0.0.1', 0), history.Handler)
                thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
                base = f'http://127.0.0.1:{server.server_port}/watch/{ident}'
                try:
                    for target in [base, base + '/stream']:
                        with self.assertRaises(HTTPError) as raised: urlopen(target)
                        self.assertEqual(raised.exception.code, 401)
                    expiry = int(w.time.time() + 600)
                    url = base + f'/stream?expires={expiry}&ticket={w.ticket(ident, expiry, "fixture")}'
                    with urlopen(Request(url, headers={'Range':'bytes=2-5', 'Origin':'https://vesper.r-vera.com'})) as response:
                        self.assertEqual(response.status, 206)
                        self.assertEqual(response.read(), b'2345')
                        self.assertEqual(response.headers['Content-Range'], 'bytes 2-5/10')
                        self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'https://vesper.r-vera.com')
                finally:
                    server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__': unittest.main()
