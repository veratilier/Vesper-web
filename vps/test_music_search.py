import unittest
from unittest.mock import Mock
from vesper_music_search import SearchCache, SearchUnavailable


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.fetch = Mock(return_value={'results': [{'trackId': 123}], 'resultCount': 1})
        self.cache = SearchCache(self.fetch, lambda: self.now)
        self.query = {'query': 'Artist Song', 'country': 'tw', 'limit': 3}

    def test_cache_normalizes_and_expires(self):
        self.assertFalse(self.cache.search(self.query)['cached'])
        self.assertTrue(self.cache.search(dict(self.query, query=' artist  SONG '))['cached'])
        self.assertEqual(self.fetch.call_count, 1)
        self.now = 21601
        self.cache.search(self.query)
        self.assertEqual(self.fetch.call_count, 2)

    def test_invalid_parameters_never_reach_network(self):
        for change in ({'query': ''}, {'query': 'a'*201}, {'country': 'http://127.0.0.1'}, {'limit': True}, {'limit': 21}):
            with self.assertRaises(ValueError): self.cache.search(dict(self.query, **change))
        self.fetch.assert_not_called()

    def test_rate_limit_and_cached_hit(self):
        for n in range(10): self.cache.search(dict(self.query, query=str(n)))
        with self.assertRaises(SearchUnavailable): self.cache.search(self.query)
        self.assertTrue(self.cache.search(dict(self.query, query='1'))['cached'])
        self.now = 61
        self.cache.search(self.query)
        self.assertEqual(self.fetch.call_count, 11)

    def test_429_cools_down_and_does_not_cache_failure(self):
        self.fetch.side_effect = SearchUnavailable('limited', 429)
        for _ in range(2):
            with self.assertRaises(SearchUnavailable): self.cache.search(self.query)
        self.assertEqual(self.fetch.call_count, 1)
        self.now = 301
        self.fetch.side_effect = None
        self.assertFalse(self.cache.search(self.query)['cached'])

    def test_empty_results_expire_sooner(self):
        self.fetch.return_value = {'results': [], 'resultCount': 0}
        self.cache.search(self.query)
        self.now = 301
        self.cache.search(self.query)
        self.assertEqual(self.fetch.call_count, 2)

    def test_cache_is_bounded(self):
        for n in range(130):
            self.now = n * 61
            self.cache.search(dict(self.query, query=str(n)))
        self.assertEqual(len(self.cache.cache), 128)

    def test_authenticated_route_and_method(self):
        import tempfile
        import threading
        import json
        from pathlib import Path
        from urllib.request import Request, urlopen
        from urllib.error import HTTPError
        from unittest.mock import patch
        import codex_history_server as server
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory) / 'token'
            token.write_text('test-only-token')
            with patch.object(server, 'TOKEN_PATH', token), patch.object(server.music_search, 'catalog', self.cache):
                http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
                worker = threading.Thread(target=http.serve_forever, daemon=True)
                worker.start()
                url = 'http://127.0.0.1:%s/music/search' % http.server_port
                try:
                    with self.assertRaises(HTTPError) as denied:
                        urlopen(Request(url, data=json.dumps(self.query).encode()), timeout=2)
                    self.assertEqual(denied.exception.code, 401)
                    denied.exception.close()
                    headers = {'Authorization': 'Bearer test-only-token'}
                    with self.assertRaises(HTTPError) as method:
                        urlopen(Request(url, headers=headers), timeout=2)
                    self.assertEqual(method.exception.code, 405)
                    method.exception.close()
                    with urlopen(Request(url, data=json.dumps(self.query).encode(), headers=headers), timeout=2) as response:
                        self.assertEqual(json.load(response)['resultCount'], 1)
                finally:
                    http.shutdown(); http.server_close(); worker.join()

if __name__ == '__main__': unittest.main()
