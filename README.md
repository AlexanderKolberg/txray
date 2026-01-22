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

3. Fetch common ABIs (ERC20, ERC721, ERC1155, Seaport):

```bash
./fetch-common-abis.sh
```

## Adding ABIs from Foundry Projects

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
