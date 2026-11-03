import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_TARGET_REPO_DIR = path.resolve(process.cwd(), "target-project");

function runGit(cwd: string, args: string[], envOverrides: Record<string, string> = {}) {
  return execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      ...envOverrides,
    },
    encoding: "utf8",
  });
}

function commitAs(
  repoDir: string,
  authorName: string,
  authorEmail: string,
  isoDate: string,
  message: string
) {
  runGit(repoDir, ["add", "-A"]);
  runGit(repoDir, ["commit", "-m", message], {
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_NAME: authorName,
    GIT_COMMITTER_EMAIL: authorEmail,
    GIT_COMMITTER_DATE: isoDate,
  });
}

function writeRepoFile(repoDir: string, relPath: string, content: string) {
  const fullPath = path.join(repoDir, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf8");
}

export function seedTargetRepo(repoDir = DEFAULT_TARGET_REPO_DIR) {
  if (existsSync(repoDir)) {
    rmSync(repoDir, { recursive: true, force: true });
  }
  mkdirSync(repoDir, { recursive: true });

  runGit(repoDir, ["init", "-b", "main"]);

  // Commit 1: Initial Python package scaffold + AsciiDoc spec v1 (Alice, Refs #1)
  writeRepoFile(
    repoDir,
    "pyproject.toml",
    `[project]
name = "pyledger"
version = "0.1.0"
description = "Lightweight Python CLI ledger and budget tracker"
requires-python = ">=3.11"
`
  );

  writeRepoFile(
    repoDir,
    "src/pyledger/__init__.py",
    `"""PyLedger - lightweight ledger and budget calculator."""\n__version__ = "0.1.0"\n`
  );

  writeRepoFile(
    repoDir,
    "docs/requirements.adoc",
    `= PyLedger Product Requirements Specification
Alice Hartmann <alice@acme.dev>
v1.0, 2026-10-02
:toc:

== Overview

PyLedger provides deterministic personal and team expense tracking from the command line.

[[REQ-001]]
== REQ-001: Exact Decimal Ledger Transactions
*Status*: Approved | *Source*: issue#1

All monetary entries MUST use base-10 \`Decimal\` arithmetic to two decimal places, supporting deposits, expenses, and exact n-way transaction splits without floating-point drift.

[[REQ-002]]
== REQ-002: Category Balance Rollups
*Status*: Approved | *Source*: issue#1

Users MUST be able to group ledger entries by category (e.g., \`hosting\`, \`travel\`, \`tooling\`) and compute net totals per category.
`
  );

  commitAs(
    repoDir,
    "Alice Hartmann",
    "alice@acme.dev",
    "2026-10-02T14:25:00Z",
    "Draft initial AsciiDoc requirements specification\n\nDefines REQ-001 and REQ-002.\nCloses #1"
  );

  // Commit 2: Core ledger implementation + unit tests (Bob, Refs #2, REQ-001, REQ-002)
  writeRepoFile(
    repoDir,
    "src/pyledger/ledger.py",
    `from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN
from typing import Iterable


@dataclass(frozen=True)
class Entry:
    description: str
    amount: Decimal
    category: str = "general"


class Ledger:
    """Core ledger engine implementing REQ-001 and REQ-002."""

    def __init__(self) -> None:
        self._entries: list[Entry] = []

    def record(self, description: str, amount: str | Decimal, category: str = "general") -> Entry:
        dec_amount = Decimal(str(amount)).quantize(Decimal("0.01"))
        entry = Entry(description=description, amount=dec_amount, category=category)
        self._entries.append(entry)
        return entry

    @property
    def entries(self) -> tuple[Entry, ...]:
        return tuple(self._entries)

    def total_balance(self) -> Decimal:
        return sum((e.amount for e in self._entries), Decimal("0.00"))

    def totals_by_category(self) -> dict[str, Decimal]:
        summary: dict[str, Decimal] = {}
        for entry in self._entries:
            summary[entry.category] = summary.get(entry.category, Decimal("0.00")) + entry.amount
        return summary


def split_amount(total: str | Decimal, parts: int) -> list[Decimal]:
    """Split an amount across parts (initial implementation with subtle rounding bug)."""
    if parts <= 0:
        raise ValueError("parts must be positive")
    dec_total = Decimal(str(total)).quantize(Decimal("0.01"))
    share = (dec_total / Decimal(parts)).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
    return [share for _ in range(parts)]
`
  );

  writeRepoFile(
    repoDir,
    "tests/test_ledger.py",
    `import unittest
from decimal import Decimal
from pyledger.ledger import Ledger, split_amount


class LedgerTest(unittest.TestCase):
    def test_balance_and_category_rollup(self) -> None:
        ledger = Ledger()
        ledger.record("Seed funding", "1000.00", "income")
        ledger.record("Cloud VM", "-125.50", "hosting")
        ledger.record("DNS renewal", "-14.50", "hosting")

        self.assertEqual(ledger.total_balance(), Decimal("860.00"))
        self.assertEqual(
            ledger.totals_by_category(),
            {
                "income": Decimal("1000.00"),
                "hosting": Decimal("-140.00"),
            },
        )

    def test_even_split(self) -> None:
        self.assertEqual(split_amount("9.00", 3), [Decimal("3.00")] * 3)


if __name__ == "__main__":
    unittest.main()
`
  );

  commitAs(
    repoDir,
    "Bob Lindqvist",
    "bob@acme.dev",
    "2026-10-05T11:20:00Z",
    "Implement core Ledger and category rollup\n\nImplements REQ-001 and REQ-002.\nCloses #2"
  );

  // Commit 3: Bug fix for remainder cent drift (Bob, Fixes #3, REQ-001)
  writeRepoFile(
    repoDir,
    "src/pyledger/ledger.py",
    `from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN


@dataclass(frozen=True)
class Entry:
    description: str
    amount: Decimal
    category: str = "general"


class Ledger:
    """Core ledger engine implementing REQ-001 and REQ-002."""

    def __init__(self) -> None:
        self._entries: list[Entry] = []

    def record(self, description: str, amount: str | Decimal, category: str = "general") -> Entry:
        dec_amount = Decimal(str(amount)).quantize(Decimal("0.01"))
        entry = Entry(description=description, amount=dec_amount, category=category)
        self._entries.append(entry)
        return entry

    @property
    def entries(self) -> tuple[Entry, ...]:
        return tuple(self._entries)

    def total_balance(self) -> Decimal:
        return sum((e.amount for e in self._entries), Decimal("0.00"))

    def totals_by_category(self) -> dict[str, Decimal]:
        summary: dict[str, Decimal] = {}
        for entry in self._entries:
            summary[entry.category] = summary.get(entry.category, Decimal("0.00")) + entry.amount
        return summary


def split_amount(total: str | Decimal, parts: int) -> list[Decimal]:
    """Split an amount across parts while preserving every cent (REQ-001)."""
    if parts <= 0:
        raise ValueError("parts must be positive")
    dec_total = Decimal(str(total)).quantize(Decimal("0.01"))
    total_cents = int(dec_total * 100)
    base_cents, remainder = divmod(abs(total_cents), parts)
    sign = -1 if total_cents < 0 else 1

    shares: list[Decimal] = []
    for idx in range(parts):
        cents = base_cents + (1 if idx < remainder else 0)
        shares.append(Decimal(sign * cents) / Decimal(100))
    return [s.quantize(Decimal("0.01")) for s in shares]
`
  );

  writeRepoFile(
    repoDir,
    "tests/test_ledger.py",
    `import unittest
from decimal import Decimal
from pyledger.ledger import Ledger, split_amount


class LedgerTest(unittest.TestCase):
    def test_balance_and_category_rollup(self) -> None:
        ledger = Ledger()
        ledger.record("Seed funding", "1000.00", "income")
        ledger.record("Cloud VM", "-125.50", "hosting")
        ledger.record("DNS renewal", "-14.50", "hosting")

        self.assertEqual(ledger.total_balance(), Decimal("860.00"))
        self.assertEqual(
            ledger.totals_by_category(),
            {
                "income": Decimal("1000.00"),
                "hosting": Decimal("-140.00"),
            },
        )

    def test_odd_three_way_split_preserves_cents(self) -> None:
        shares = split_amount("10.00", 3)
        self.assertEqual(shares, [Decimal("3.34"), Decimal("3.33"), Decimal("3.33")])
        self.assertEqual(sum(shares), Decimal("10.00"))


if __name__ == "__main__":
    unittest.main()
`
  );

  commitAs(
    repoDir,
    "Bob Lindqvist",
    "bob@acme.dev",
    "2026-10-07T10:40:00Z",
    "Fix split_amount remainder cent drift\n\nPreserves exact cent sum per REQ-001.\nFixes #3"
  );

  // Commit 4: AsciiDoc spec update adding REQ-003 (Budget Alerts) and REQ-004 (Multi-currency)
  writeRepoFile(
    repoDir,
    "docs/requirements.adoc",
    `= PyLedger Product Requirements Specification
Alice Hartmann <alice@acme.dev>
v1.1, 2026-10-08
:toc:

== Overview

PyLedger provides deterministic personal and team expense tracking from the command line.

[[REQ-001]]
== REQ-001: Exact Decimal Ledger Transactions
*Status*: Approved | *Source*: issue#1

All monetary entries MUST use base-10 \`Decimal\` arithmetic to two decimal places, supporting deposits, expenses, and exact n-way transaction splits without floating-point drift.

[[REQ-002]]
== REQ-002: Category Balance Rollups
*Status*: Approved | *Source*: issue#1

Users MUST be able to group ledger entries by category (e.g., \`hosting\`, \`travel\`, \`tooling\`) and compute net totals per category.

[[REQ-003]]
== REQ-003: Monthly Category Budget Threshold Alerts
*Status*: In Progress | *Source*: issue#4

Administrators MUST be able to configure monthly spending caps per category and evaluate \`ok\`, \`warning\` (>= 80%), and \`exceeded\` (> 100%) status levels.

[[REQ-004]]
== REQ-004: Multi-Currency FX Normalization
*Status*: Proposed | *Source*: issue#5

Imported CSV entries in EUR, GBP, or JPY MUST be normalized into the ledger's base currency using pinned daily FX rates.
`
  );

  commitAs(
    repoDir,
    "Alice Hartmann",
    "alice@acme.dev",
    "2026-10-08T10:05:00Z",
    "Expand AsciiDoc specification with REQ-003 and REQ-004\n\nLinks budget alerts (#4) and multi-currency roadmap (#5)."
  );

  // Commit 5: Budget threshold implementation WITHOUT unit tests yet (Bob, Refs #4, REQ-003)
  writeRepoFile(
    repoDir,
    "src/pyledger/budget.py",
    `from decimal import Decimal
from pyledger.ledger import Ledger


def evaluate_budget(ledger: Ledger, limits: dict[str, Decimal]) -> dict[str, str]:
    """Evaluate spending against category caps per REQ-003."""
    totals = ledger.totals_by_category()
    statuses: dict[str, str] = {}
    for category, limit in limits.items():
        spent = abs(min(totals.get(category, Decimal("0.00")), Decimal("0.00")))
        if spent > limit:
            statuses[category] = "exceeded"
        elif spent >= (limit * Decimal("0.80")):
            statuses[category] = "warning"
        else:
            statuses[category] = "ok"
    return statuses
`
  );

  commitAs(
    repoDir,
    "Bob Lindqvist",
    "bob@acme.dev",
    "2026-10-09T14:55:00Z",
    "Add budget threshold evaluator\n\nImplements initial logic for REQ-003.\nRefs #4"
  );

  // Commit 6: Untracked CLI formatting hotfix (Process Mining anomaly: no Issue or REQ link, no test!)
  writeRepoFile(
    repoDir,
    "src/pyledger/cli.py",
    `from pyledger.ledger import Ledger


def format_summary_ascii(ledger: Ledger) -> str:
    """Ad-hoc helper added directly on main without an issue or spec entry."""
    lines = ["CATEGORY | AMOUNT", "---------+-------"]
    for cat, total in sorted(ledger.totals_by_category().items()):
        lines.append(f"{cat:<8} | {total:>6}")
    return "\\n".join(lines)
`
  );

  commitAs(
    repoDir,
    "Bob Lindqvist",
    "bob@acme.dev",
    "2026-10-11T19:15:00Z",
    "Quick CLI summary formatter tweak before demo"
  );

  return repoDir;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = seedTargetRepo();
  console.log(`Seeded sample Python Git repository at: ${dir}`);
}
