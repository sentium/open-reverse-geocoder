import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("admin", Path(__file__).resolve().parents[1] / "bin/build-japan-admin.py")
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)


class AdministrativeNames(unittest.TestCase):
    def test_current_schema_and_leading_zero(self):
        row = dict(N03_001="北海道", N03_003="目梨郡", N03_004="羅臼町", N03_005="", N03_007="01694")
        code, props = admin.properties(row)
        self.assertEqual(str(code).zfill(5), "01694")
        self.assertEqual(props, dict(prefecture="北海道", city="目梨郡羅臼町"))
        row.update(N03_001="静岡県", N03_003="", N03_004="浜松市", N03_005="中央区", N03_007="22138")
        self.assertEqual(admin.properties(row), (22138, dict(prefecture="静岡県", city="浜松市中央区")))

    def test_unassigned_area_does_not_invent_municipality(self):
        row = dict(N03_001="千葉県", N03_003="", N03_004="所属未定地", N03_005="", N03_007="12000")
        self.assertEqual(admin.properties(row), (12000, dict(prefecture="千葉県", city="")))

    def test_old_or_broken_schema_is_rejected(self):
        row = dict(N03_001="大阪府", N03_003="大阪市", N03_004="北区", N03_007="27127")
        with self.assertRaises(ValueError):
            admin.properties(row)
        row.update(N03_005="", N03_007="not-a-code")
        with self.assertRaises(ValueError):
            admin.properties(row)


if __name__ == "__main__":
    unittest.main()
