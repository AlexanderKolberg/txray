# txray Roadmap

> Based on real debugging sessions from NFT bundling issues with Seaport/SignedZone

## Executive Summary

This document outlines improvements to txray based on pain points discovered while debugging complex EVM transactions involving Seaport, SignedZone, Sequence wallets, and bundled calls.

**Core insight**: txray currently decodes *logs* well, but real debugging requires:
1. Decoding *input calldata* (often nested/bundled)
2. Understanding *protocol-specific data formats* (SignedZone extraData)
3. Looking up *unknown error selectors*
4. Querying *on-chain state* at transaction time
5. *Comparing* working vs. failing transactions

---

## Priority Matrix

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | SignedZone ABI + ExtraData Decoder | Medium | High |
| P0 | Input Calldata Decoder | Medium | High |
| P1 | Error Selector Lookup (4byte) | Low | High |
| P1 | Expanded Known Contracts | Low | Medium |
| P2 | Transaction Diff Mode | Medium | Medium |
| P2 | On-Chain State Verification | Medium | Medium |
| P3 | Timestamp/Expiration Warnings | Low | Low |

---

## P0: Critical Features

### 1. SignedZone ABI + ExtraData Decoder

**Problem**: OpenSea's SignedZone uses a custom `extraData` format (SIP-6/SIP-7) that contains critical debugging information but requires manual byte-level parsing.

**Evidence**: `decode-tx.ts` in debug-notes manually parses:
```typescript
function decodeSignedZoneExtraData(extraDataHex: string): DecodedExtraData {
  const bytes = hexToBytes(extraDataHex as `0x${string}`);
  
  // byte 0: SIP-6 version
  const sipVersion = bytes[0];
  
  // bytes 1-21: expectedFulfiller (20 bytes)
  const expectedFulfiller = '0x' + Array.from(bytes.slice(1, 21))...
  
  // bytes 21-29: expiration (uint64)
  const expiration = BigInt('0x' + Array.from(bytes.slice(21, 29))...
  
  // bytes 29-93: signature (64 bytes, EIP-2098 compact)
  const signature = '0x' + Array.from(bytes.slice(29, 93))...
  
  // byte 93: substandard version
  // bytes 94+: context (varies by substandard)
}
```

**Solution**:

#### 1.1 Create `abi/signed-zone.ts`

```typescript
export const SIGNED_ZONE_ABI = [
  // Errors
  {
    type: 'error',
    name: 'SignerNotActive',
    inputs: [
      { name: 'signer', type: 'address' },
      { name: 'orderHash', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'SignatureExpired',
    inputs: [
      { name: 'expiration', type: 'uint256' },
      { name: 'orderHash', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidFulfiller',
    inputs: [
      { name: 'expectedFulfiller', type: 'address' },
      { name: 'actualFulfiller', type: 'address' },
      { name: 'orderHash', type: 'bytes32' },
    ],
  },
  {
    type: 'error',
    name: 'InvalidExtraDataLength',
    inputs: [{ name: 'orderHash', type: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'InvalidSIP6Version',
    inputs: [{ name: 'orderHash', type: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'InvalidSubstandardVersion',
    inputs: [{ name: 'orderHash', type: 'bytes32' }],
  },
  // Functions
  {
    type: 'function',
    name: 'authorizeOrder',
    inputs: [
      {
        name: 'zoneParameters',
        type: 'tuple',
        components: [
          { name: 'orderHash', type: 'bytes32' },
          { name: 'fulfiller', type: 'address' },
          { name: 'offerer', type: 'address' },
          // ... (see Seaport ZoneParameters struct)
        ],
      },
    ],
    outputs: [{ name: 'authorizedOrderMagicValue', type: 'bytes4' }],
  },
] as const;

export const KNOWN_CONTRACTS = {
  // SignedZones by chain
  '0x000056f7000000ece9003ca63978907a00ffd100': 'OpenSea SignedZone',
};
```

#### 1.2 Create `src/decoders/signed-zone.ts`

```typescript
export interface SignedZoneExtraData {
  sipVersion: number;
  expectedFulfiller: `0x${string}`;
  isZeroAddress: boolean;
  expiration: bigint;
  expirationDate: Date;
  isExpired: boolean;  // relative to provided timestamp
  signature: `0x${string}`;
  substandardVersion: number;
  context: `0x${string}`;
  // Substandard 7 specific (transfer validation)
  transferValidation?: {
    identifier: bigint;
    registry: `0x${string}`;
    operator: `0x${string}`;
  };
}

export function decodeSignedZoneExtraData(
  extraData: `0x${string}`,
  txTimestamp?: Date
): SignedZoneExtraData {
  // Implementation...
}
```

#### 1.3 Integrate with main decoder

When txray sees a call to Seaport's `fulfillAdvancedOrder`, automatically decode the `extraData` field and display:

```
SEAPORT ORDER DETAILS
─────────────────────
Offerer:     0xdBf1...c5BA
Zone:        0x0000...D100 (OpenSea SignedZone)
Token:       ERC721 #4843 @ 0x66ef...5d0D
Price:       0.00039 ETH

SIGNED ZONE EXTRA DATA
──────────────────────
SIP Version:         0
Expected Fulfiller:  0x0000...0000 (any)
Expiration:          2026-01-26 12:34:29 UTC
                     ⚠️  EXPIRED (tx was at 12:57:00)
Signature:           0xbe36...78e4...
Substandard:         7 (Transfer Validation)
  Registry:          0x721c...3e00
  Operator:          0x1e00...3c71 (OpenSea Conduit)
```

---

### 2. Input Calldata Decoder

**Problem**: Complex transactions have nested calldata that needs recursive decoding. The Intent Wallet bundles multiple calls in a packed format.

**Evidence**: Debug scripts had to manually search for selectors in raw calldata:
```typescript
const seaportSelector = 'e7acab24';  // fulfillAdvancedOrder
const seaportIdx = input.toLowerCase().indexOf(seaportSelector);
if (seaportIdx !== -1) {
  const seaportCalldata = '0x' + input.slice(seaportIdx);
  // Now decode...
}
```

**Solution**:

#### 2.1 New CLI command: `txray decode`

```bash
# Decode raw calldata
txray decode 0xe7acab24000000...

# Decode from transaction
txray decode --tx 0x29f3c9...

# Output
DECODED INPUT
─────────────
Function: fulfillAdvancedOrder
├─ advancedOrder
│  ├─ parameters
│  │  ├─ offerer: 0xdBf152768b25571363859057CE902115CDadc5BA
│  │  ├─ zone: 0x000056F7000000EcE9003ca63978907a00FFD100 (OpenSea SignedZone)
│  │  ├─ offer: [1 item]
│  │  │  └─ ERC721: 0x66ef...5d0D #4843
│  │  ├─ consideration: [3 items]
│  │  │  ├─ 0.000357 ETH → 0xdBf1...c5BA (seller)
│  │  │  ├─ 0.000004 ETH → 0x0000...a719 (OpenSea Fee)
│  │  │  └─ 0.000029 ETH → 0x2333...E7a5 (royalty)
│  │  └─ orderType: 2 (FULL_RESTRICTED)
│  ├─ signature: 0xc49b...f6d0... (328 bytes)
│  └─ extraData: [SIGNED ZONE DATA - see above]
├─ criteriaResolvers: []
├─ fulfillerConduitKey: 0x0000007b... (OpenSea Conduit)
└─ recipient: 0x0000...0000
```

#### 2.2 Recursive decoding for bundled calls

Detect and decode nested call patterns:

```typescript
// Intent Wallet bundle format detection
const INTENT_WALLET_HEADER = '01020400';

// Guest Module selector
const GUEST_MODULE_WRAP = '1f6a1eb9';  // wrap(bytes32,Call[])

// Detect and recurse
function decodeCalldata(data: Hex): DecodedCall {
  if (data.startsWith('0x' + INTENT_WALLET_HEADER)) {
    return decodeIntentWalletBundle(data);
  }
  
  const selector = data.slice(0, 10);
  if (selector === '0x' + GUEST_MODULE_WRAP) {
    const decoded = decodeFunctionData({ abi: GUEST_MODULE_ABI, data });
    // Recursively decode each Call in the bundle
    return {
      function: 'wrap',
      args: {
        ...decoded.args,
        calls: decoded.args.calls.map(call => ({
          to: call.to,
          value: call.value,
          data: decodeCalldata(call.data),  // Recurse!
        })),
      },
    };
  }
  
  // Try all known ABIs...
}
```

#### 2.3 Visual call tree

```
CALL TREE
─────────
EOA 0x18a7...c060
└─ CALL Intent Wallet (0x0000...8806) value=0.00039 ETH
   └─ CREATE2 Guest Module (0x6f72...ede6)
      └─ DELEGATECALL wrap(...)
         ├─ [0] CALL Seaport.fulfillAdvancedOrder() value=0.00039 ETH
         │      ├─ Order: ERC721 #4843 for 0.00039 ETH
         │      └─ Zone: SignedZone → authorizeOrder() ❌ FAILED
         ├─ [1] CALL NFT.safeTransferFrom() ⏭️ SKIPPED (previous failed)
         └─ [2] CALL sweep() ⏭️ SKIPPED
```

---

## P1: High-Value Features

### 3. Error Selector Lookup

**Problem**: Unknown error selectors require manual research.

**Evidence**: `trace-failed-tx.ts` shows manual selector computation:
```typescript
const limitBreakErrors = [
  'CallerNotOperator()',
  'NotAuthorized(address,address,address,uint256)',
  // ... 20+ more
];

for (const error of limitBreakErrors) {
  const funcSelector = keccak256(toBytes(error)).slice(0, 10);
  console.log(`${error}: ${funcSelector}`);
}
```

And still hit unknown: `0x8ffff980` - never identified.

**Solution**:

#### 3.1 Local selector database

Create `src/selectors.ts` with precomputed selectors:

```typescript
export const ERROR_SELECTORS: Record<string, string> = {
  // Seaport
  '0xfb5014fc': 'InvalidRestrictedOrder(bytes32)',
  '0x1a515574': 'InsufficientNativeTokensSupplied()',
  '0xaba113d0': 'OrderAlreadyFilled(bytes32)',
  
  // SignedZone
  '0x1f003d0a': 'SignerNotActive(address,bytes32)',
  '0x6088d7de': 'SignatureExpired(uint256,bytes32)',
  '0x135e76b6': 'InvalidFulfiller(address,address,bytes32)',
  
  // LimitBreak / Creator Token
  '0x6ab37ce7': 'CallerNotOperator()',
  '0x8ffff980': 'CallerMustBeWhitelistedOperator()',  // Found it!
  
  // ... 100+ more common selectors
};

export const FUNCTION_SELECTORS: Record<string, string> = {
  '0xe7acab24': 'fulfillAdvancedOrder(...)',
  '0x1f6a1eb9': 'wrap(bytes32,Call[])',
  '0x42842e0e': 'safeTransferFrom(address,address,uint256)',
  // ...
};
```

#### 3.2 Online lookup fallback

```typescript
async function lookupSelector(selector: string): Promise<string | null> {
  // Try local first
  if (ERROR_SELECTORS[selector]) return ERROR_SELECTORS[selector];
  if (FUNCTION_SELECTORS[selector]) return FUNCTION_SELECTORS[selector];
  
  // Fallback to 4byte.directory
  try {
    const res = await fetch(
      `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`
    );
    const data = await res.json();
    if (data.results?.[0]) {
      return data.results[0].text_signature;
    }
  } catch {}
  
  // Fallback to openchain.xyz
  try {
    const res = await fetch(
      `https://api.openchain.xyz/signature-database/v1/lookup?function=${selector}`
    );
    const data = await res.json();
    // ...
  } catch {}
  
  return null;
}
```

#### 3.3 CLI command

```bash
txray selector 0x8ffff980

# Output:
SELECTOR: 0x8ffff980
─────────────────────
Match: CallerMustBeWhitelistedOperator()
Source: LimitBreak Creator Token Transfer Validator
Context: NFT uses transfer restrictions requiring operator whitelist
```

---

### 4. Expanded Known Contracts

**Problem**: Many addresses in traces are unlabeled.

**Solution**: Expand `known.ts`:

```typescript
export const KNOWN_CONTRACTS: Record<string, string> = {
  // === Seaport ===
  '0x0000000000000068f116a894984e2db1123eb395': 'Seaport 1.6',
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc': 'Seaport 1.5',
  '0x00000000000001ad428e4906ae43d8f9852d0dd6': 'Seaport 1.4',
  
  // === SignedZones ===
  '0x000056f7000000ece9003ca63978907a00ffd100': 'OpenSea SignedZone',
  
  // === Conduits ===
  '0x1e0049783f008a0085193e00003d00cd54003c71': 'OpenSea Conduit',
  '0x2052f8a2ff46283b30084e5d84c89a2fdbe7f74b': 'Magic Eden Conduit',
  
  // === Fee Recipients ===
  '0x0000a26b00c1f0df003000390027140000faa719': 'OpenSea Fee Recipient',
  
  // === Sequence/Trails ===
  '0x0000000000006ac72ed1d192fa28f0058d3f8806': 'Sequence Intent Wallet',
  
  // === Transfer Validators (LimitBreak) ===
  '0x721c00787f008a0085193e00003d00cd54003c71': 'LimitBreak Transfer Validator',
  
  // === WETH by chain ===
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH (Mainnet)',
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH (Arbitrum)',
  '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'WETH (Polygon)',
  '0x4200000000000000000000000000000000000006': 'WETH (Base/OP/Blast)',
  
  // === Blur ===
  '0x0000000000a39bb272e79075ade125fd351887ac': 'Blur Pool',
  '0x000000000000ad05ccc4f10045630fb830b95127': 'Blur Marketplace',
  
  // === X2Y2 ===
  '0x74312363e45dcaba76c59ec49a7aa8a65a67eed3': 'X2Y2 Marketplace',
  
  // === LooksRare ===
  '0x0000000000e655fae4d56241588680f86e3b2377': 'LooksRare V2',
};
```

---

## P2: Medium-Value Features

### 5. Transaction Diff Mode

**Problem**: Comparing working vs. failing transactions requires manual side-by-side analysis.

**Evidence**: README.md documents manual comparison:
```
FAILED TX:  Order Type: 2, Salt: 27855...
WORKING TX: Order Type: 3, Salt: 0
```

**Solution**:

```bash
txray diff 0x29f3c9... 0xe5e5ff...

# Output:
TRANSACTION COMPARISON
──────────────────────
                        FAILED (0x29f3...)    WORKING (0xe5e5...)
Status                  ❌ reverted           ✅ success
Block                   296847123             296512456
Time                    Jan 26 12:34          Jan 23 06:26

SEAPORT ORDER
─────────────
Offerer                 0xdBf1...c5BA         0x1B5c...D454        ← DIFFERENT
Order Type              2 (FULL_RESTRICTED)   3 (PARTIAL_RESTR.)   ← DIFFERENT
Start Time              Jan 26 05:41          Jan 23 03:06
End Time                Jul 25 05:41          Jan 23 18:06         ← DIFFERENT
Salt                    27855337018...        0                    ← DIFFERENT
Token ID                4843                  8838                 ← DIFFERENT

SIGNED ZONE
───────────
Expected Fulfiller      0x0000 (any)          0x0000 (any)         ✓ SAME
Expiration              Jan 26 12:34          Jan 23 06:26
Expired at TX time?     YES ⚠️                 NO                   ← ROOT CAUSE?
```

---

### 6. On-Chain State Verification

**Problem**: Need to check if order was already filled, NFT transferred, etc.

**Evidence**: `verify-nft-status.ts` manually queries:
```typescript
const owner = await client.readContract({
  address: NFT_CONTRACT,
  abi: erc721Abi,
  functionName: 'ownerOf',
  args: [TOKEN_ID],
});

const status = await client.readContract({
  address: SEAPORT,
  abi: seaportAbi,
  functionName: 'getOrderStatus',
  args: [orderHash],
});
```

**Solution**:

```bash
txray verify 0x29f3c9...

# Output:
STATE VERIFICATION (at block 296847123)
───────────────────────────────────────

NFT STATUS
  Contract: 0x66ef...5d0D
  Token ID: 4843
  Owner:    0xdBf1...c5BA (seller)
  Status:   ✅ Seller still owns NFT

SEAPORT ORDER STATUS
  Order Hash: 0x7a3f...
  Validated:  false
  Cancelled:  false
  Filled:     0/1
  Status:     ✅ Order available

BALANCES
  Intent Wallet ETH: 0.00039 ETH ✅ Sufficient
  Seller NFT:        1 ✅ Has token

APPROVALS
  NFT → OpenSea Conduit: ✅ Approved
```

---

## P3: Nice-to-Have Features

### 7. Timestamp/Expiration Warnings

When decoding data that contains timestamps, compare to transaction time:

```typescript
function formatTimestamp(ts: bigint, txTime: Date): string {
  const date = new Date(Number(ts) * 1000);
  const formatted = date.toISOString();
  
  if (date < txTime) {
    const diff = Math.floor((txTime.getTime() - date.getTime()) / 1000 / 60);
    return `${formatted} ⚠️ EXPIRED (${diff} min before tx)`;
  }
  
  return formatted;
}
```

---

## Implementation Order

### Phase 1: Foundation (1-2 days)
1. Add SignedZone ABI (`abi/signed-zone.ts`)
2. Add LimitBreak ABI (`abi/limitbreak.ts`)
3. Expand known contracts
4. Add error selector database

### Phase 2: Input Decoding (2-3 days)
1. Create `txray decode` command
2. Implement recursive calldata decoding
3. Add special handling for Seaport orders
4. Add SignedZone extraData decoder

### Phase 3: Advanced Features (2-3 days)
1. `txray selector` command with online lookup
2. `txray diff` command
3. `txray verify` command
4. Timestamp warnings

---

## File Structure After Implementation

```
txray/
├── src/
│   ├── cli.ts
│   ├── debug.ts
│   ├── networks.ts
│   ├── abis.ts
│   ├── errors.ts
│   ├── selectors.ts          # NEW: selector database
│   ├── commands/
│   │   ├── decode.ts         # NEW: calldata decoder
│   │   ├── selector.ts       # NEW: selector lookup
│   │   ├── diff.ts           # NEW: tx comparison
│   │   └── verify.ts         # NEW: state verification
│   └── decoders/
│       ├── seaport.ts        # NEW: Seaport-specific decoding
│       ├── signed-zone.ts    # NEW: SignedZone extraData
│       └── intent-wallet.ts  # NEW: Sequence bundle decoding
├── abi/
│   ├── seaport.ts
│   ├── signed-zone.ts        # NEW
│   ├── limitbreak.ts         # NEW
│   ├── guest-module.ts       # NEW
│   ├── erc20.ts
│   ├── erc721.ts
│   ├── erc1155.ts
│   ├── sequence.ts
│   ├── trails.ts
│   └── trails-router.ts
├── known.ts                   # Expanded
└── known-private.ts
```

---

## Testing Plan

For each feature, test against real transactions:

| Feature | Test Transaction | Expected |
|---------|------------------|----------|
| SignedZone decode | `0x29f3c957...` | Show expectedFulfiller=0x0, expiration, substandard 7 |
| Input decode | `0xe5e5ffd2...` | Full Seaport order tree |
| Selector lookup | `0x8ffff980` | `CallerMustBeWhitelistedOperator()` |
| Diff mode | Both above | Highlight Order Type, Salt, Expiration differences |
| Verify | `0x29f3c957...` | Show NFT ownership, order status |

---

## References

- [SIP-7 (SignedZone)](https://github.com/ProjectOpenSea/SIPs/blob/main/SIPS/sip-7.md)
- [Seaport Documentation](https://docs.opensea.io/reference/seaport-overview)
- [4byte Directory](https://www.4byte.directory/)
- [OpenChain Signature Database](https://openchain.xyz/signatures)
- [LimitBreak Creator Token](https://github.com/limitbreakinc/creator-token-contracts)
