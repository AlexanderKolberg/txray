# txray Development Plan

> Each feature starts with a new branch and ends with a PR.
> Architecture principle: **Generic infrastructure over protocol-specific code.**

---

## Completed Tasks

- [x] Remove unused `ethers` dependency

---

## Phase 0: Foundation & Tooling

### PR #1: Setup Development Tooling
**Branch:** `feat/dev-tooling`
**Priority:** HIGHEST (blocking all other work)

- [ ] Add `tsconfig.json` with strict mode
- [ ] Configure Biome for formatting
- [ ] Setup OxLint for linting
- [ ] Add `package.json` scripts: `lint`, `format`, `typecheck`

---

## Phase 1: Core Infrastructure

### PR #2: Configurable Address Labels
**Branch:** `feat/address-labels`

- [ ] Create `labels.json` schema (address -> name mapping)
- [ ] Load from `~/.config/txray/labels.json` and local `./labels.json`
- [ ] Merge with any existing hardcoded labels
- [ ] Add `--labels ./custom.json` CLI flag
- [ ] Ship with empty/minimal defaults (users populate)

### PR #3: Dynamic Selector Lookup
**Branch:** `feat/selector-lookup`

- [ ] Create `src/selectors.ts` with local cache
- [ ] Auto-fetch unknown selectors from 4byte.directory / openchain.xyz
- [ ] Cache results to `~/.cache/txray/selectors.json`
- [ ] Add `txray selector <0x...>` command for manual lookup
- [ ] Graceful fallback when offline

### PR #4: Input Calldata Decoder
**Branch:** `feat/calldata-decoder`

- [ ] Create `txray decode <calldata>` command
- [ ] Decode using loaded ABIs (from `abi/` folder)
- [ ] Recursive decoding for nested calls (detect Call[] patterns)
- [ ] Visual tree output for complex calldata
- [ ] `--tx <hash>` flag to decode from transaction

### PR #5: Decoder Plugin System
**Branch:** `feat/decoder-plugins`

- [ ] Create `decoders/` folder for user plugins
- [ ] Define `Decoder` interface:
  ```typescript
  interface Decoder {
    name: string;
    match: (data: Hex, context: DecodeContext) => boolean;
    decode: (data: Hex, context: DecodeContext) => DecodedData;
  }
  ```
- [ ] Auto-load `*.decoder.ts` from `~/.config/txray/decoders/` and local `./decoders/`
- [ ] Plugin priority system (user plugins override defaults)
- [ ] Ship example decoder as reference

---

## Phase 2: CLI & UX

### PR #6: CLI UX Basics
**Branch:** `feat/cli-ux`

- [ ] Add `--help` and `--version` flags
- [ ] Add `--json` output format
- [ ] Add loading spinner with `ora`
- [ ] Colored output improvements

### PR #7: Error Handling Improvements
**Branch:** `feat/error-handling`

- [ ] Wrap ABI loading in try/catch
- [ ] Better RPC error messages (not found, rate limited, timeout)
- [ ] Validate `abi/` directory gracefully (warn, don't crash)
- [ ] Add `--timeout <ms>` flag

### PR #8: Config File Support
**Branch:** `feat/config-file`

- [ ] Support `~/.config/txray/config.json`
- [ ] Options: default chain, custom RPCs, output format, timeout
- [ ] Environment variable overrides (`TXRAY_RPC_URL`, etc.)
- [ ] `txray config` command to show/edit config

---

## Phase 3: Testing & Quality

### PR #9: Unit Tests Foundation
**Branch:** `feat/unit-tests`

- [ ] Setup test framework (bun:test)
- [ ] Tests for `parseExplorerUrl()`
- [ ] Tests for `decodeAllLogs()`
- [ ] Tests for `tryDecodeError()`
- [ ] Tests for selector lookup
- [ ] Tests for label resolution

### PR #10: CI Pipeline
**Branch:** `feat/ci-pipeline`

- [ ] GitHub Actions workflow
- [ ] Type checking, linting, tests, build verification
- [ ] PR checks

---

## Phase 4: Advanced Decoding

### PR #11: Transaction Diff Mode
**Branch:** `feat/tx-diff`

- [ ] Create `txray diff <tx1> <tx2>` command
- [ ] Generic struct comparison (works with any decoded data)
- [ ] Highlight differences in calldata, logs, status
- [ ] Side-by-side or unified output

### PR #12: Call Trace Support
**Branch:** `feat/call-trace`

- [ ] Add `--trace` flag using `debug_traceTransaction`
- [ ] Visual call tree with depth indicators
- [ ] Show gas per call
- [ ] Graceful fallback if node doesn't support tracing

### PR #13: State Diff Analysis
**Branch:** `feat/state-diff`

- [ ] Add `--state-diff` flag
- [ ] Show storage changes before/after
- [ ] Decode storage slots using ABIs when possible

### PR #14: Gas Analysis
**Branch:** `feat/gas-analysis`

- [ ] Add `--gas` flag
- [ ] Gas breakdown per call
- [ ] Top gas consumers table

---

## Phase 5: Analysis Features

### PR #15: Fund Flow / Token Transfer Summary
**Branch:** `feat/fund-flow`

- [ ] Add `--flow` flag
- [ ] Detect ERC20/721/1155 Transfer events (generic, ABI-based)
- [ ] Track all token movements
- [ ] Net balance changes summary

### PR #16: On-Chain State Queries
**Branch:** `feat/state-query`

- [ ] Create `txray query` command
- [ ] Generic contract read: `txray query <address> <function> [args]`
- [ ] Use loaded ABIs for encoding/decoding
- [ ] `--block <number>` for historical queries

### PR #17: ENS Resolution
**Branch:** `feat/ens`

- [ ] Resolve ENS names in output (when on mainnet)
- [ ] Reverse resolve addresses to ENS
- [ ] Cache ENS lookups
- [ ] `--no-ens` flag to disable

---

## Phase 6: Code Quality

### PR #18: Code Refactoring
**Branch:** `refactor/code-cleanup`

- [ ] Split `formatDebugResult` into smaller functions
- [ ] Extract input parsing to `src/input.ts`
- [ ] Magic numbers to constants
- [ ] Add JSDoc comments to public functions

### PR #19: Robustness Improvements
**Branch:** `feat/robustness`

- [ ] RPC timeout configuration
- [ ] Retry logic with exponential backoff
- [ ] Fallback RPC support (try multiple)
- [ ] Graceful degradation (show what we can)

---

## Phase 7: Advanced Features

### PR #20: Transaction Simulation
**Branch:** `feat/tx-simulation`

- [ ] `txray simulate` command using `eth_call`
- [ ] `--from`, `--to`, `--data`, `--value` flags
- [ ] State overrides support (`--override`)

### PR #21: Interactive TUI Debugger
**Branch:** `feat/tui-debugger`

- [ ] Opcode-by-opcode stepping
- [ ] Stack/memory/storage view
- [ ] Keyboard navigation

### PR #22: ABI Auto-Fetch
**Branch:** `feat/abi-fetch`

- [ ] Fetch from Etherscan/Sourcify for verified contracts
- [ ] `txray abi fetch <address> --chain <id>`
- [ ] Cache fetched ABIs locally
- [ ] Auto-fetch on decode if ABI missing (with flag)

### PR #23: Proxy Detection
**Branch:** `feat/proxy-detection`

- [ ] Detect common proxy patterns (EIP-1967, EIP-1822, etc.)
- [ ] Show implementation address
- [ ] Fetch implementation ABI automatically

---

## Phase 8: Distribution

### PR #24: Publish to npm
**Branch:** `feat/npm-publish`

- [ ] Package configuration
- [ ] README for npm
- [ ] Publish workflow

### PR #25: Standalone Binary
**Branch:** `feat/standalone-binary`

- [ ] `bun build --compile` configuration
- [ ] Install script
- [ ] Release workflow

---

## Architecture Overview

```
~/.config/txray/
├── config.json          # User configuration
├── labels.json          # Address -> name mappings
├── decoders/            # Custom decoder plugins
│   └── my-protocol.decoder.ts
└── ...

~/.cache/txray/
├── selectors.json       # Cached 4byte lookups
├── abi/                 # Fetched ABIs
└── ...

./txray/
├── abi/                 # Project ABIs (user adds their own)
├── decoders/            # Project-specific decoder plugins
├── labels.json          # Project-specific labels
└── src/
    ├── cli.ts
    ├── decoder-registry.ts    # Loads ABIs + plugins
    ├── selector-lookup.ts     # Dynamic selector resolution
    ├── label-resolver.ts      # Address -> name resolution
    └── ...
```

---

## Workflow Reminder

```bash
# Start new feature
git checkout main
git pull
git checkout -b feat/feature-name

# Work on feature...

# Finish and create PR
git add .
git commit -m "feat: description"
git push -u origin feat/feature-name
gh pr create --title "feat: description" --body "..."
```
