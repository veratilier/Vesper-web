"""Authenticated route registry; domain endpoints cannot bypass gateway authentication."""
from . import notifications_routes, companion_routes, media_routes, tools_routes, automation_routes, history_routes
ROUTES = (('notifications', notifications_routes.dispatch), ('companion', companion_routes.dispatch),
          ('media', media_routes.dispatch), ('tools', tools_routes.dispatch),
          ('automation', automation_routes.dispatch), ('history', history_routes.dispatch))
def public(handler, parts, services):
    handled = media_routes.public(handler, parts, services)
    if handled: handler.service_name = 'media'
    return handled
def dispatch(handler, path, services):
    for name, handle in ROUTES:
        handler.service_name = name
        if handle(handler, path, services): return
    handler.service_name = 'gateway'
    handler.send_json(404, {'error': 'Not found'})
