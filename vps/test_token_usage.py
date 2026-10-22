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

    def test_rollout_aggregates_tool_rounds_and_separates_turns(self):
        counter=usage.RolloutUsage()
        def report(input, cached, output, last_input, last_cached, last_output):
            counter.observe({'type':'token_count','info':{
                'total_token_usage':{'input_tokens':input,'cached_input_tokens':cached,'output_tokens':output,'total_tokens':input+output},
                'last_token_usage':{'input_tokens':last_input,'cached_input_tokens':last_cached,'output_tokens':last_output,'total_tokens':last_input+last_output}}})
        counter.observe({'type':'task_started','turn_id':'one'})
        report(11000,9000,120,1000,800,20)  # Existing cumulative history precedes this first observed turn.
        report(12200,10000,150,1200,1000,30)
        report(12200,10000,150,1200,1000,30)  # Duplicate notification.
        counter.observe({'type':'task_complete','turn_id':'one'})
        self.assertEqual(counter.turns['one']['totalTokens'],2250)
        self.assertEqual(counter.turns['one']['cachedInputTokens'],1800)
        self.assertTrue(counter.turns['one']['complete'])
        counter.observe({'type':'task_started','turn_id':'two'})
        report(13500,11200,200,1300,1200,50)
        self.assertEqual(counter.turns['two']['totalTokens'],1350)


if __name__ == '__main__': unittest.main()
