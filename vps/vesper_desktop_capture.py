"""One bounded X11 root capture; no HTML, browser viewport or synthesized UI."""
import io
import os
import sys
from PIL import ImageGrab


def capture():
    if sys.platform != 'linux':
        raise RuntimeError('This capture helper only runs on the Linux VPS.')
    image = ImageGrab.grab(xdisplay=os.environ.get('DISPLAY', ':94'))
    if image.width > 2400 or image.height > 1800:
        raise RuntimeError('Unexpected desktop size.')
    for quality in (65, 45, 30):
        output = io.BytesIO()
        image.convert('RGB').save(output, format='JPEG', quality=quality)
        if output.tell() <= 512 * 1024:
            return output.getvalue()
    raise RuntimeError('Desktop frame exceeds the size limit.')


if __name__ == '__main__':
    sys.stdout.buffer.write(capture())
