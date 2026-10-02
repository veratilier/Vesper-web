"""Bounded, authenticated-route Apple catalog search; no playback credentials."""
import json
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from collections import OrderedDict, deque
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, HTTPRedirectHandler, build_opener


class SearchUnavailable(Exception):
    def __init__(self, message, status=503, retry_after=300):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def fetch_catalog(params):
    request = Request('https://itunes.apple.com/search?' + urlencode(params),
                      headers={'User-Agent': 'Vesper/1.0', 'Accept': 'application/json'})
    try:
        with build_opener(NoRedirect).open(request, timeout=8) as response:
            payload = response.read(1_000_001)
            if len(payload) > 1_000_000:
                raise SearchUnavailable('Apple Music metadata response is too large')
            data = json.loads(payload)
            if not isinstance(data, dict) or not isinstance(data.get('results'), list):
                raise ValueError()
            keys = ('kind', 'trackId', 'trackName', 'artistName', 'collectionName',
                    'artworkUrl100', 'trackViewUrl', 'trackTimeMillis')
            results = [{key: row[key] for key in keys if key in row}
                       for row in data['results'][:20] if isinstance(row, dict)]
            return {'results': results, 'resultCount': len(results)}
    except HTTPError as error:
        retry = error.headers.get('Retry-After', '') if error.headers else ''
        try:
            delay = float(retry) if retry.isdigit() else (parsedate_to_datetime(retry) - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            delay = 300
        raise SearchUnavailable('Apple Music search rate limited; wait before trying again' if error.code == 429
                                else 'Apple Music search unavailable: HTTP ' + str(error.code),
                                429 if error.code == 429 else 503, max(300, delay)) from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise SearchUnavailable('Apple Music search unavailable; try again later') from None


class SearchCache:
    def __init__(self, fetch=fetch_catalog, clock=time.monotonic):
        self.fetch, self.clock = fetch, clock
        self.lock = threading.Lock()
        self.cache = OrderedDict()
        self.recent = deque()
        self.blocked_until = 0

    def search(self, body):
        query, country, limit = body.get('query'), body.get('country', 'tw'), body.get('limit', 8)
        if (not isinstance(query, str) or not query.strip() or len(query) > 200
                or country not in ('cn', 'tw') or type(limit) is not int or not 1 <= limit <= 20):
            raise ValueError('Invalid music search parameters')
        query = ' '.join(query.split())
        key = (query.casefold(), country, limit)
        # Serializes misses so concurrent model calls share the same result.
        with self.lock:
            now = self.clock()
            cached = self.cache.get(key)
            if cached and cached[0] > now:
                self.cache.move_to_end(key)
                return dict(cached[1], cached=True)
            if self.blocked_until > now:
                raise SearchUnavailable('Apple Music search is cooling down; try again later', 429)
            while self.recent and self.recent[0] <= now - 60:
                self.recent.popleft()
            if len(self.recent) >= 10:
                raise SearchUnavailable('Apple Music search rate limited; try again later', 429)
            self.recent.append(now)
            try:
                data = self.fetch({'term': query, 'entity': 'song', 'country': country, 'limit': limit})
            except SearchUnavailable as error:
                self.blocked_until = now + (error.retry_after if error.status == 429 else 30)
                raise
            self.cache[key] = (self.clock() + (21600 if data['results'] else 300), data)
            self.cache.move_to_end(key)
            while len(self.cache) > 128:
                self.cache.popitem(last=False)
            return dict(data, cached=False)


catalog = SearchCache()
