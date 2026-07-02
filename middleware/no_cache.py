_NO_CACHE = [
    (b"cache-control", b"no-cache, no-store, must-revalidate"),
    (b"pragma",        b"no-cache"),
    (b"expires",       b"0"),
]

_SKIP_KEYS = {b"cache-control", b"pragma", b"expires"}


class NoCacheStaticMiddleware:
    """Pure-ASGI middleware — avoids BaseHTTPMiddleware CancelledError noise on shutdown."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope.get("path", "").startswith(
            ("/static/js/", "/static/css/")
        ):
            await self.app(scope, receive, send)
            return

        async def send_with_no_cache(message):
            if message["type"] == "http.response.start":
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if k.lower() not in _SKIP_KEYS
                ]
                message = {**message, "headers": headers + _NO_CACHE}
            await send(message)

        await self.app(scope, receive, send_with_no_cache)
