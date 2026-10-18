"""The renderer must create a real image without loading a Web page."""
import base64
from io import BytesIO
import unittest
from unittest.mock import patch

from PIL import Image
import vesper_chat_screenshot as screenshot


class ScreenshotRenderTests(unittest.TestCase):
    def test_explicit_bubbles_are_drawn_separately_and_palette_changes_background(self):
        parts = ['第一句。', '第二句。', '第三句。', '第四句。', '第五句。']
        message = {'id': 'a', 'role': 'agent', 'content': '\n\n'.join(parts),
                   'createdAt': '2026-10-19T02:36:30+08:00', 'attachments': [],
                   'textBubbles': parts}
        blue = screenshot.render_child({'messages': [message], 'appearance': {'palette': 'blue', 'shade': 0.28}})
        white = screenshot.render_child({'messages': [message], 'appearance': {'palette': 'white', 'shade': 0.28}})
        blue_image = Image.open(BytesIO(base64.b64decode(blue['base64'])))
        white_image = Image.open(BytesIO(base64.b64decode(white['base64'])))
        self.assertNotEqual(blue_image.getpixel((5, 5)), white_image.getpixel((5, 5)))
        joined = {**message, 'textBubbles': ['\n\n'.join(parts)]}
        joined_image = Image.open(BytesIO(base64.b64decode(
            screenshot.render_child({'messages': [joined]})['base64'])))
        self.assertGreater(blue_image.height, joined_image.height)

    def test_user_paragraphs_are_separate_bubbles(self):
        content = '好萌呀好萌呀…\n\n咋这么萌…\n\n我打字的时候都是笑眯眯的'
        message = {'id': 'u', 'role': 'user', 'content': content,
                   'createdAt': '2026-10-19T03:25:00+08:00', 'attachments': []}
        tail = {'id': 'a', 'role': 'agent', 'content': '回应。' * 30, 'attachments': []}
        split = screenshot.render_child({'messages': [message, tail]})
        joined = screenshot.render_child({'messages': [{**message, 'textBubbles': [content]}, tail]})
        split_image = Image.open(BytesIO(base64.b64decode(split['base64'])))
        joined_image = Image.open(BytesIO(base64.b64decode(joined['base64'])))
        self.assertGreater(split_image.height, joined_image.height)

    def test_glass_settings_change_the_bubble_surface(self):
        message = {'id': 'u', 'role': 'user', 'content': '玻璃质感', 'attachments': []}
        base = {'palette': 'white', 'shade': 0.28}
        appearances = [
            {**base, 'glassStyle': 'liquid', 'glassFrost': False},
            {**base, 'glassStyle': 'liquid', 'glassFrost': True},
            {**base, 'glassStyle': 'classic', 'glassTransparency': 0.0},
            {**base, 'glassStyle': 'classic', 'glassTransparency': 1.0},
            {**base, 'glassStyle': 'liquid', 'reduceTransparency': True},
        ]
        images = [Image.open(BytesIO(base64.b64decode(
            screenshot.render_child({'messages': [message], 'appearance': appearance})['base64'])))
            for appearance in appearances]
        self.assertEqual(len({image.getpixel((115, 105)) for image in images}), len(images))
        self.assertEqual(len({image.getpixel((10, 10)) for image in images}), 1)

    def test_original_photo_and_text_render_together(self):
        photo = BytesIO()
        Image.new('RGB', (200, 130), '#ba4320').save(photo, 'JPEG')
        data = {
            'messageIds': ['u', 'a'],
            'messages': [
                {'id': 'u', 'role': 'user', 'content': '这张照片\n你还记得吗？',
                 'createdAt': '2026-10-19T02:36:19+08:00',
                 'attachments': [{'url': 'https://api.vesper.r-vera.com/api/media/a.jpg', 'type': 'image/jpeg'}]},
                {'id': 'a', 'role': 'agent', 'content': '记得。', 'createdAt': '2026-10-19T02:36:30+08:00',
                 'attachments': []},
            ],
        }
        with patch.object(screenshot, '_photo_bytes', return_value=photo.getvalue()):
            result = screenshot.render_child(data)
        picture = Image.open(BytesIO(base64.b64decode(result['base64'])))
        self.assertEqual(picture.width, screenshot.PHONE_WIDTH)
        self.assertGreater(picture.height, 420)
        self.assertEqual(result['mimeType'], 'image/jpeg')


if __name__ == '__main__':
    unittest.main()
