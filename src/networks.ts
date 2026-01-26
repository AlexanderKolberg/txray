import { allNetworks, findNetworkConfig, type NetworkConfig } from '@0xsequence/network';

export interface ParsedTxUrl {
	txHash: `0x${string}`;
	chainId: number;
	network: NetworkConfig;
}

function getHostname(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

function fuzzyMatchHostname(inputHost: string, explorerHost: string): boolean {
	if (inputHost === explorerHost) return true;

	const normalizedInput = inputHost.replace(/^www\./, '');
	const normalizedExplorer = explorerHost.replace(/^www\./, '');
	if (normalizedInput === normalizedExplorer) return true;

	if (normalizedInput.endsWith(`.${normalizedExplorer}`)) return true;
	if (normalizedExplorer.endsWith(`.${normalizedInput}`)) return true;

	return false;
}

export function parseExplorerUrl(url: string): ParsedTxUrl {
	const txHashMatch = url.match(/\/tx\/(0x[a-fA-F0-9]{64})/);
	if (!txHashMatch?.[1]) {
		throw new Error(`Could not extract transaction hash from URL: ${url}`);
	}
	const txHash = txHashMatch[1].toLowerCase() as `0x${string}`;

	const inputHostname = getHostname(url);
	if (!inputHostname) {
		throw new Error(`Invalid URL: ${url}`);
	}

	let matchedNetwork = allNetworks.find((network) => {
		const explorerUrl = network.blockExplorer?.rootUrl;
		if (!explorerUrl) return false;
		const explorerHostname = getHostname(explorerUrl);
		return explorerHostname === inputHostname;
	});

	if (!matchedNetwork) {
		matchedNetwork = allNetworks.find((network) => {
			const explorerUrl = network.blockExplorer?.rootUrl;
			if (!explorerUrl) return false;
			const explorerHostname = getHostname(explorerUrl);
			return explorerHostname && fuzzyMatchHostname(inputHostname, explorerHostname);
		});
	}

	if (!matchedNetwork) {
		throw new Error(`Unknown block explorer: ${url}`);
	}

	return {
		txHash,
		chainId: matchedNetwork.chainId,
		network: matchedNetwork,
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
