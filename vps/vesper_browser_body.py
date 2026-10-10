"""Bounded visible-text inspection even while a document has no body yet."""
import asyncio

async def visible_body(page):
    # Locator.inner_text waits for a body to exist. A slow/blocked SPA can have
    # a title but no body, needlessly preventing a screenshot of its actual state.
    # Do not catch evaluation errors: privacy inspection must succeed before
    # existing cookie redaction and screenshot masking are allowed to run.
    return await asyncio.wait_for(
        page.evaluate("() => document.body ? document.body.innerText : ''"),
        timeout=2.5,
    )


def patch_source(source):
    """Narrow integration with the separately managed, authenticated browser."""
    old = "body=await self.page.locator('body').inner_text(timeout=2500)"
    new = "body=await visible_body(self.page)"
    if source.count(old) != 1:
        raise ValueError('Browser source changed; inspect before applying')
    patched = 'from vesper_browser_body import visible_body\n' + source.replace(old, new)
    compile(patched, 'server.py', 'exec')
    return patched
