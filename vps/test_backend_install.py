import ast,unittest
from unittest.mock import patch
from pathlib import Path
from install_backend_boundaries import patch_wake
class InstallTests(unittest.TestCase):
    def test_already_migrated_runner_keeps_existing_business_code(self):
        source=Path(__file__).with_name('vesper_wake_runner.py').read_text()
        self.assertEqual(patch_wake(source),source)
    def test_legacy_source_migrates_without_version_dependent_ast_dump(self):
        source=Path(__file__).with_name('fixtures').joinpath('legacy_wake_transport.py').read_text()
        with patch('ast.dump', side_effect=AssertionError('AST representations vary across Python versions')):
            result=patch_wake(source)
        self.assertIn('class Rpc(CodexRpc):',result)
        before=next(n for n in ast.parse(source).body if isinstance(n,ast.FunctionDef))
        after=next(n for n in ast.parse(result).body if isinstance(n,ast.FunctionDef))
        self.assertEqual(ast.get_source_segment(source,before),ast.get_source_segment(result,after))
        self.assertEqual(patch_wake(result),result)
    def test_unknown_live_transport_is_rejected_instead_of_overwritten(self):
        with self.assertRaises(ValueError):patch_wake('CONFIG={}\nclass Rpc:\n def __init__(self):pass\n')
if __name__=='__main__':unittest.main()
