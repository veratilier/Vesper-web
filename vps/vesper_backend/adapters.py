"""Convert an HTTP request to domain input and return its committed result."""
from urllib.parse import parse_qs, urlparse
from .chat import ChatService

def chat_endpoint(operation):
    def handle(request, *arguments):
        service = ChatService(request.services,
            query=parse_qs(urlparse(getattr(request, 'path', '')).query),
            body=getattr(request, 'body', None), method=getattr(request, 'command', 'GET'))
        getattr(service, operation)(*arguments)
        if service.result is not None:
            request.send_json(service.result.status, service.result.value)
    handle.__name__ = operation
    return handle
