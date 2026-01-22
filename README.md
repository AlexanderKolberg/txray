# txray

X-ray for EVM transactions. Debug and decode transaction traces from any supported chain.

## Installation

1. Install [Bun](https://bun.sh) with your favorite package manager:

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# or via brew
brew install oven-sh/bun/bun

# or via npm
npm install -g bun
```

2. Install dependencies:

```bash
bun i
```

3. Link the CLI globally:

```bash
bun link
```

## Adding ABIs

The tool uses ABIs to decode transactions. Here are different ways to add them:

### Fetch Common ABIs

Fetch a set of common ABIs (ERC20, ERC721, ERC1155, Seaport):

```bash
./fetch-common-abis.sh
```

To add more ABIs to this set, edit the `ABIS` array in `fetch-common-abis.sh`:

```bash
ABIS=(
  "https://raw.githubusercontent.com/ProjectOpenSea/seaport-js/main/src/abi/ERC20.ts"
  "https://raw.githubusercontent.com/ProjectOpenSea/seaport-js/main/src/abi/ERC721.ts"
  # Add more URLs here...
)
```

### Extract from Foundry Projects

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation):

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Extract ABIs from local Foundry projects:

```bash
./extract-foundry-abi.sh <foundry-project-path> <ContractName> [output-name]
```

The script will:
- Build the project if needed
- Extract the ABI as JSON
- Save it to `abi/<output-name>.ts` as a TypeScript const export

Examples:

```bash
./extract-foundry-abi.sh ../my-contracts IMyContract my-contract
./extract-foundry-abi.sh ../seaport Seaport seaport-v1.6
```

Output format:

```typescript
export const MY_CONTRACT_ABI = [...] as const;
```

### Manual ABI Files

You can also add ABI files manually to the `abi/` directory. Each file can export:
- An ABI array as a const export
- Optional `KNOWN_TOPICS` and `KNOWN_CONTRACTS` mappings

## Known Topics and Contracts

The `known.ts` file at the project root contains human-readable mappings for common event topics and contract addresses:

```typescript
// Event topic hashes → readable names
export const KNOWN_TOPICS: Record<string, string> = {
  '0xddf252ad...': 'Transfer',
  '0x8c5be1e5...': 'Approval',
  // ...
};

// Contract addresses → readable names
export const KNOWN_CONTRACTS: Record<string, string> = {
  '0x0000000000000068f116a894984e2db1123eb395': 'Seaport 1.6',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH (Mainnet)',
  // ...
};
```

These mappings are used during trace decoding to display friendly names instead of raw hashes/addresses. Add your own commonly-used topics and contracts here.

ABI files in `abi/` can also export their own `KNOWN_TOPICS` and `KNOWN_CONTRACTS` which will be merged with the base mappings.

## Usage

```bash
# Using a block explorer URL
txray https://polygonscan.com/tx/0xabc123...
txray https://etherscan.io/tx/0xdef456...
txray https://arbiscan.io/tx/0x789...

# Using tx hash + chain ID
txray 0xabc123... 137
```

Supports most block explorers.
