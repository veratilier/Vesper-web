"""Export only actual generated images belonging to one active Vesper chat."""
import base64
import hashlib
import os
import stat
import uuid
from pathlib import Path
import vesper_conversation_delete as deletion

MAX_BYTES = 8 * 1024 * 1024


def export_image(con, conversation_id, thread_id, image_path):
    row = con.execute('SELECT codex_thread_id, archived_at FROM conversations WHERE vesper_conversation_id=?', (conversation_id,)).fetchone()
    if not row or row['archived_at'] or not row['codex_thread_id'] or deletion.is_deleted(con, conversation_id, row['codex_thread_id']):
        raise ValueError('Original conversation is unavailable')
    ident = str(uuid.UUID(str(thread_id)))
    if ident != row['codex_thread_id']:
        raise ValueError('Generated image belongs to a different conversation')
    if not isinstance(image_path, str) or not image_path or len(image_path) > 2048:
        raise ValueError('Provide the actual generated image path')
    root = deletion.CODEX_HOME.resolve() / 'generated_images' / ident
    candidate = Path(image_path)
    if not candidate.is_absolute():
        candidate = root / candidate
    # Reject traversal and symlinks rather than following them into private files.
    if '..' in candidate.parts or not candidate.is_relative_to(root):
        raise ValueError('Only this chat’s generated images can be sent by path')
    current = deletion.CODEX_HOME.resolve()
    for component in candidate.relative_to(current).parts:
        current = current / component
        if current.is_symlink():
            raise ValueError('Generated image symlinks cannot be sent')
    try:
        fd = os.open(candidate, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_BYTES:
                raise ValueError('Generated image must be a regular file up to 8 MiB')
            data = stream.read(MAX_BYTES + 1)
    except OSError as error:
        raise ValueError('Generated image file is unavailable') from error
    if len(data) != info.st_size or len(data) > MAX_BYTES:
        raise ValueError('Generated image changed during transfer; retry')
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        mime = 'image/png'
    elif data.startswith(b'\xff\xd8\xff'):
        mime = 'image/jpeg'
    elif data.startswith((b'GIF87a', b'GIF89a')):
        mime = 'image/gif'
    elif data.startswith(b'RIFF') and data[8:12] == b'WEBP':
        mime = 'image/webp'
    else:
        raise ValueError('Generated file is not a supported image')
    return {'name': candidate.name, 'mimeType': mime, 'base64': base64.b64encode(data).decode('ascii'),
            'size': len(data), 'digest': hashlib.sha256(data).hexdigest()}
