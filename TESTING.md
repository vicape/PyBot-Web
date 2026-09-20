# PyBot Web testing strategy

PyBot Web uses layered QA so normal development is protected by tests without forcing every small change through every structural check.

## Suites

### Fast behavior — `npm test` / `npm run test:fast`

Runs the behavior-oriented suite used by normal development and Maxwell STANDARD tasks.

Current classification: **26 test files**.

Use it for:
- business logic;
- pure functions;
- protocol parsing that is cheap and deterministic;
- roles, courses and submission behavior;
- i18n behavior;
- version consistency.

A fast test should prefer inputs/outputs and observable behavior over source-code regexes.

### Contracts — `npm run test:contracts`

Runs compatibility and persistence contracts that are expensive or sensitive.

Current classification: **31 test files**.

Use it for:
- EDA6 and ESP32 contracts;
- BLE/MicroPython transport and runtime behavior;
- firmware lifecycle;
- database/migration contracts;
- immutable submission/version guarantees;
- hardware bridge behavior.

Maxwell runs this suite when the actual diff is classified as sensitive.

### Architecture — `npm run test:architecture`

Runs structural/source-wiring checks.

Current classification: **14 test files**.

These tests may inspect source files, imports, wiring, absence of deprecated paths, or architectural boundaries. They remain useful, but they are intentionally outside the critical path for ordinary STANDARD changes because a correct refactor may change implementation shape without changing product behavior.

Architecture failures should be reviewed as architecture signals, not automatically treated as user-facing regressions.

### Full — `npm run test:full`

Runs every classified test exactly once.

The manifest test guarantees that every `test/*.test.mjs` file belongs to exactly one suite and that no file is classified twice.

### Full release QA — `npm run qa:full`

Runs the full test suite and then the production build.

The control repository also runs fast + contracts + architecture + build on a scheduled full QA.

## Test-writing rules

1. Prefer behavior:
   - given input/state;
   - invoke exported behavior;
   - assert observable output/state.

2. Use source inspection only when the source shape itself is an intentional contract:
   - forbidden imports;
   - required dynamic import boundary;
   - firmware wiring that cannot yet be exercised directly;
   - security/migration invariants.

3. Do not hardcode the current PyBot Web package version in unrelated tests.
   Version consistency is checked dynamically in `versionConsistency.test.mjs`.

4. A product text change should not normally require changing a test unless the text itself is the product contract.

5. A refactor that preserves behavior should not fail fast tests merely because a function, variable, import, or JSX location moved.

6. Architecture tests should be progressively replaced by behavioral/integration tests when the code becomes testable through stable module boundaries.

## Maxwell policy

- STANDARD: fast tests + build.
- STRICT: fast tests + contract tests + build + independent review.
- Architecture/full: scheduled/manual QA, not the normal repair loop.
- Previously failing individual tests may be rerun directly before escalating to a suite.

This keeps safety while avoiding repeated full-suite repair loops for low-risk changes.
