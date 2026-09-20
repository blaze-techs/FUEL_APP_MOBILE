#!/usr/bin/env python3
"""Migrate legacy GLOBAL localStorage business-data keys to user-scoped access.

Each target is a (file, key) pair whose previous value was global and therefore
leaked across accounts on a shared device.
"""
import re
import sys
from pathlib import Path

ROOT = Path("src/react-app")

# (relative path, legacy key)
TARGETS = [
    ("components/PointOfSale.tsx", "fuelpro_pos_transactions"),
    ("components/CreditManagement.tsx", "fuelpro_credit_accounts"),
    ("components/CreditManagement.tsx", "fuelpro_credit_tx"),
    ("components/PayrollSystem.tsx", "fuelpro_payroll_employees"),
    ("components/PayrollSystem.tsx", "fuelpro_payroll_settings"),
    ("components/ShiftManagement.tsx", "fuelpro_employees"),
    ("components/ShiftManagement.tsx", "fuelpro_shifts"),
    ("components/CustomerLoyalty.tsx", "fuelpro_customers"),
    ("components/News.tsx", "fuelpro_news_bookmarks"),
    ("components/News.tsx", "fuelpro_news_read"),
    ("components/FuelTypesManager.tsx", "fuelpro_custom_fuel_types"),
    ("components/ExpenseTracker.tsx", "fuelpro_expense_budget"),
    ("components/DocumentConverter.tsx", "fuelpro_converter_jobs"),
    ("components/CallCenter.tsx", "fuelpro_call_center_followups_v2"),
    ("hooks/useDataIntegration.ts", "fuelpro_credit_accounts"),
    ("hooks/useDataIntegration.ts", "fuelpro_credit_tx"),
    ("hooks/useDataIntegration.ts", "fuelpro_customers"),
    ("hooks/useDataIntegration.ts", "fuelpro_employees"),
    ("hooks/useDataIntegration.ts", "fuelpro_inventory"),
    ("hooks/useDataIntegration.ts", "fuelpro_shifts"),
]

IMPORT_LINE = (
    'import { readScopedLocal, writeScopedLocal } from '
    '"@/react-app/lib/scoped-local-storage";'
)


def migrate(path: Path, key: str) -> int:
    src = path.read_text()
    changed = 0

    # read:  localStorage.getItem(KEY)              -> readScopedLocal(KEY, null)
    pat_read = re.compile(r'localStorage\.getItem\(\s*"' + re.escape(key) + r'"\s*\)')
    src, n = pat_read.subn(f'readScopedLocal("{key}", null)', src)
    changed += n

    # write: localStorage.setItem(KEY, VALUE)       -> writeScopedLocal(KEY, VALUE)
    pat_write = re.compile(
        r'localStorage\.setItem\(\s*("' + re.escape(key) + r'")\s*,', re.S
    )
    src, n = pat_write.subn(lambda m: f'writeScopedLocal({m.group(1)},', src)
    changed += n

    if changed:
        if IMPORT_LINE not in src:
            lines = src.split("\n")
            last = -1
            for i, ln in enumerate(lines):
                if ln.startswith("import "):
                    last = i
            if last >= 0:
                lines.insert(last + 1, IMPORT_LINE)
            else:
                lines.insert(0, IMPORT_LINE)
            src = "\n".join(lines)
        path.write_text(src)

    return changed


def main() -> int:
    total = 0
    for rel, key in TARGETS:
        p = ROOT / rel
        if not p.exists():
            print(f"SKIP (missing) {rel}")
            continue
        n = migrate(p, key)
        if n:
            print(f"{n:2d}  {rel}  [{key}]")
        total += n
    print(f"\ntotal replacements: {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main())