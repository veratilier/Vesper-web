import importlib.util
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


spec = importlib.util.spec_from_file_location('vesper_daily_quotes', Path(__file__).with_name('vesper_daily_quotes.py'))
quotes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quotes)


class QuoteScheduleTests(unittest.TestCase):
    def test_daily_slots_are_spaced_and_stable(self):
        day = '2026-10-25'
        for count in range(1, 6):
            times = [quotes.due_time(day, slot, count) for slot in range(count)]
            self.assertEqual(times, [quotes.due_time(day, slot, count) for slot in range(count)])
            self.assertEqual(times, sorted(times))
            for slot, stamp in enumerate(times):
                local = datetime.fromtimestamp(stamp, ZoneInfo('Asia/Shanghai'))
                self.assertEqual(local.strftime('%Y-%m-%d'), day)
                minute = local.hour * 60 + local.minute
                width = 720 // count
                self.assertGreaterEqual(minute, 540 + slot * width)
                self.assertLess(minute, 540 + (slot + 1) * width)


if __name__ == '__main__':
    unittest.main()
