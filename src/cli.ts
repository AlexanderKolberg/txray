#!/usr/bin/env bun
import { parseExplorerUrl, getNetworkByChainId } from './networks.js';
import { debugTransaction, formatDebugResult } from './debug.js';

async function main() {
	const args = process.argv.slice(2);

	if (args.length === 0) {
		printUsage();
		process.exit(1);
	}

	const input = args[0];

	try {
		let txHash: `0x${string}`;
		let chainId: number;

		if (input.startsWith('http')) {
			const parsed = parseExplorerUrl(input);
			txHash = parsed.txHash;
			chainId = parsed.chainId;
			console.log(`Detected chain: ${parsed.network.title || parsed.network.name} (${chainId})`);
		} else if (input.startsWith('0x')) {
			txHash = input.toLowerCase() as `0x${string}`;
			chainId = args[1] ? parseInt(args[1], 10) : 1;
			if (isNaN(chainId)) {
				console.error('Invalid chain ID');
				process.exit(1);
			}
		} else {
			console.error('Invalid input. Provide a block explorer URL or tx hash.');
			printUsage();
			process.exit(1);
		}

		const network = getNetworkByChainId(chainId);
		console.log(`Fetching transaction ${txHash}...\n`);

		const result = await debugTransaction(network, txHash);
		console.log(formatDebugResult(result));
	} catch (error) {
		console.error('Error:', (error as Error).message);
		process.exit(1);
	}
}

function printUsage() {
	console.log(`
txray - X-ray for EVM transactions

USAGE:
  txray <explorer-url>
  txray <tx-hash> [chain-id]

EXAMPLES:
  txray https://polygonscan.com/tx/0xabc123...
  txray https://etherscan.io/tx/0xdef456...
  txray https://arbiscan.io/tx/0x789...
  txray 0xabc123... 137

SUPPORTED EXPLORERS:
  etherscan.io, polygonscan.com, arbiscan.io, optimistic.etherscan.io,
  basescan.org, bscscan.com, snowtrace.io, and more.
`);
}

main();
