import ast,unittest
from pathlib import Path
from install_backend_boundaries import patch_wake
class InstallTests(unittest.TestCase):
    def test_already_migrated_runner_keeps_existing_business_code(self):
        source=Path(__file__).with_name('vesper_wake_runner.py').read_text()
        self.assertEqual(patch_wake(source),source)
    def test_unknown_live_transport_is_rejected_instead_of_overwritten(self):
        with self.assertRaises(ValueError):patch_wake('CONFIG={}\nclass Rpc:\n def __init__(self):pass\n')
if __name__=='__main__':unittest.main()
