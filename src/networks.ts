import { allNetworks, findNetworkConfig, type NetworkConfig } from '@0xsequence/network';

const EXPLORER_PATTERNS: Array<{
	pattern: RegExp;
	chainId: number;
}> = [
	{ pattern: /etherscan\.io/, chainId: 1 },
	{ pattern: /polygonscan\.com/, chainId: 137 },
	{ pattern: /arbiscan\.io/, chainId: 42161 },
	{ pattern: /optimistic\.etherscan\.io/, chainId: 10 },
	{ pattern: /basescan\.org/, chainId: 8453 },
	{ pattern: /bscscan\.com/, chainId: 56 },
	{ pattern: /snowtrace\.io/, chainId: 43114 },
	{ pattern: /ftmscan\.com/, chainId: 250 },
	{ pattern: /gnosisscan\.io/, chainId: 100 },
	{ pattern: /celoscan\.io/, chainId: 42220 },
	{ pattern: /moonbeam\.moonscan\.io/, chainId: 1284 },
	{ pattern: /moonriver\.moonscan\.io/, chainId: 1285 },
	{ pattern: /nova\.arbiscan\.io/, chainId: 42170 },
	{ pattern: /blastscan\.io/, chainId: 81457 },
	{ pattern: /lineascan\.build/, chainId: 59144 },
	{ pattern: /mantlescan\.xyz/, chainId: 5000 },
	{ pattern: /scrollscan\.com/, chainId: 534352 },
	{ pattern: /era\.zksync\.network/, chainId: 324 },
	{ pattern: /sepolia\.etherscan\.io/, chainId: 11155111 },
	{ pattern: /goerli\.etherscan\.io/, chainId: 5 },
	{ pattern: /mumbai\.polygonscan\.com/, chainId: 80001 },
	{ pattern: /amoy\.polygonscan\.com/, chainId: 80002 },
	{ pattern: /sepolia\.arbiscan\.io/, chainId: 421614 },
	{ pattern: /sepolia-optimism\.etherscan\.io/, chainId: 11155420 },
	{ pattern: /sepolia\.basescan\.org/, chainId: 84532 },
];

export interface ParsedTxUrl {
	txHash: `0x${string}`;
	chainId: number;
	network: NetworkConfig;
}

export function parseExplorerUrl(url: string): ParsedTxUrl {
	const txHashMatch = url.match(/\/tx\/(0x[a-fA-F0-9]{64})/);
	if (!txHashMatch) {
		throw new Error(`Could not extract transaction hash from URL: ${url}`);
	}
	const txHash = txHashMatch[1].toLowerCase() as `0x${string}`;

	const matchedExplorer = EXPLORER_PATTERNS.find((e) => e.pattern.test(url));
	if (!matchedExplorer) {
		throw new Error(`Unknown block explorer: ${url}`);
	}

	const network = findNetworkConfig(allNetworks, matchedExplorer.chainId);
	if (!network) {
		throw new Error(`Network config not found for chain ID: ${matchedExplorer.chainId}`);
	}

	return {
		txHash,
		chainId: matchedExplorer.chainId,
		network,
	};
}

export function getNetworkByChainId(chainId: number): NetworkConfig {
	const network = findNetworkConfig(allNetworks, chainId);
	if (!network) {
		throw new Error(`Network config not found for chain ID: ${chainId}`);
	}
	return network;
}

export function getRpcUrl(network: NetworkConfig): string {
	return network.rpcUrl;
}

export function getExplorerTxUrl(network: NetworkConfig, txHash: string): string {
	const baseUrl = network.blockExplorer?.rootUrl;
	if (!baseUrl) {
		return `https://blockscan.com/tx/${txHash}`;
	}
	return `${baseUrl}tx/${txHash}`;
}

export function getTenderlyUrl(network: NetworkConfig, txHash: string): string {
	return `https://dashboard.tenderly.co/tx/${network.name}/${txHash}`;
}

export function getPhalconUrl(network: NetworkConfig, txHash: string): string {
	return `https://app.blocksec.com/explorer/tx/${network.name}/${txHash}`;
}
