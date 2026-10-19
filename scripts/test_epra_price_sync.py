import unittest
from scripts.epra_price_sync import extract_effective_dates, extract_from_text, parse_price

class EpraParserTests(unittest.TestCase):
    def test_effective_dates_accept_current_cycle(self):
        self.assertEqual(
            extract_effective_dates("Maximum retail petroleum prices for the period 15th October 2026 to 14th November 2026"),
            ("2026-10-15", "2026-11-14"),
        )

    def test_missing_effective_dates_fail_closed(self):
        with self.assertRaises(RuntimeError):
            extract_effective_dates("EPRA fuel price update")

    def test_price_parser_rejects_out_of_range_values(self):
        self.assertEqual(parse_price("KSh 232.90"), 232.90)
        self.assertIsNone(parse_price("21.90"))
        self.assertIsNone(parse_price("999.99"))

    def test_extract_table_rows_preserves_three_fuel_values(self):
        rows = extract_from_text("122 Lodwar 232.90 234.10 226.23")
        self.assertTrue(rows)
        self.assertEqual(rows[0]["petrol"], 232.90)
        self.assertEqual(rows[0]["diesel"], 234.10)
        self.assertEqual(rows[0]["kerosene"], 226.23)

if __name__ == "__main__":
    unittest.main()
