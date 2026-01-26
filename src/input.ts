import { loadConfig } from './config.js';
import { getNetworkByChainId, parseExplorerUrl } from './networks.js';

export interface ParsedInput {
	txHash: `0x${string}`;
	chainId: number;
	network: ReturnType<typeof getNetworkByChainId>;
}

export function parseTransactionInput(input: string, chainIdArg?: string): ParsedInput {
	if (input.startsWith('http')) {
		const parsed = parseExplorerUrl(input);
		return {
			txHash: parsed.txHash,
			chainId: parsed.chainId,
			network: parsed.network,
		};
	}

	if (input.startsWith('0x')) {
		const config = loadConfig();
		const txHash = input.toLowerCase() as `0x${string}`;
		const chainId = chainIdArg ? Number.parseInt(chainIdArg, 10) : (config.defaultChain ?? 1);

		if (Number.isNaN(chainId)) {
			throw new Error('Invalid chain ID');
		}

		return {
			txHash,
			chainId,
			network: getNetworkByChainId(chainId),
		};
	}

	throw new Error('Invalid input. Provide a block explorer URL or tx hash.');
}

export function parseAddressInput(input: string): `0x${string}` {
	if (!input.startsWith('0x') || input.length !== 42) {
		throw new Error('Invalid address format. Expected 0x followed by 40 hex characters.');
	}
	return input.toLowerCase() as `0x${string}`;
}

export function parseHexInput(input: string): `0x${string}` {
	if (!input.startsWith('0x')) {
		throw new Error('Invalid hex input. Expected 0x prefix.');
	}
	return input.toLowerCase() as `0x${string}`;
}
