import json, unittest
import vesper_token_usage as usage


class TokenUsageTests(unittest.TestCase):
    def test_rollout_and_live_counts_use_the_same_fields(self):
        saved=usage.snapshot({'input_tokens':1000,'cached_input_tokens':800,'output_tokens':100,
                              'reasoning_output_tokens':20,'total_tokens':1100},complete=True)
        self.assertEqual(saved['totalTokens'],1100)
        self.assertEqual(saved['cachedInputTokens']/saved['inputTokens'],0.8)
        self.assertEqual(usage.stored(json.dumps(saved),complete=True),saved)

    def test_unknown_cache_is_not_reported_as_zero(self):
        saved=usage.snapshot({'inputTokens':1000,'outputTokens':100,'totalTokens':1100})
        self.assertNotIn('cachedInputTokens',saved)
        self.assertIsNone(usage.snapshot({'inputTokens':1000,'cachedInputTokens':1001,'outputTokens':0,'totalTokens':1000}))
        self.assertIsNone(usage.snapshot({'inputTokens':True,'outputTokens':0,'totalTokens':1}))
        self.assertIsNone(usage.stored('invalid'))


if __name__ == '__main__': unittest.main()
