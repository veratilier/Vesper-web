import unittest
from vesper_wake_runner import photo_content_items, photo_result_without_pixels


class WakePhotoResultTests(unittest.TestCase):
    def test_previews_reach_model_as_images_but_not_workflow_storage(self):
        result = {
            'photos': [{'id': 'photo-1', 'capturedAt': '2026-10-19T00:00:00Z',
                        'imageDataUrl': 'data:image/jpeg;base64,/9j/AA=='}],
            'nextOffset': None,
        }
        stored = photo_result_without_pixels(result)
        self.assertNotIn('imageDataUrl', stored['photos'][0])
        self.assertIn('imageDataUrl', result['photos'][0])
        items = photo_content_items(result)
        self.assertEqual([item['type'] for item in items], ['inputText', 'inputImage'])
        self.assertNotIn('base64', items[0]['text'])
        self.assertEqual(items[1]['imageUrl'], result['photos'][0]['imageDataUrl'])


if __name__ == '__main__':
    unittest.main()
