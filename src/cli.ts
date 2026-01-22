#!/usr/bin/env bun
import pc from 'picocolors';
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
			console.log(`${pc.dim('Chain:')} ${pc.cyan(parsed.network.title || parsed.network.name)} ${pc.dim(`(${chainId})`)}`);
		} else if (input.startsWith('0x')) {
			txHash = input.toLowerCase() as `0x${string}`;
			chainId = args[1] ? parseInt(args[1], 10) : 1;
			if (isNaN(chainId)) {
				console.error(pc.red('Invalid chain ID'));
				process.exit(1);
			}
		} else {
			console.error(pc.red('Invalid input. Provide a block explorer URL or tx hash.'));
			printUsage();
			process.exit(1);
		}

		const network = getNetworkByChainId(chainId);
		console.log(`${pc.dim('Fetching')} ${pc.dim(txHash.slice(0, 10))}${pc.dim('...')}\n`);

		const result = await debugTransaction(network, txHash);
		console.log(formatDebugResult(result));
	} catch (error) {
		console.error(`${pc.red('Error:')} ${(error as Error).message}`);
		process.exit(1);
	}
}

function printUsage() {
	console.log(`
${pc.bold('txray')} ${pc.dim('- X-ray for EVM transactions')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray')} ${pc.dim('<explorer-url>')}
  ${pc.cyan('txray')} ${pc.dim('<tx-hash> [chain-id]')}

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray https://polygonscan.com/tx/0xabc123...')}
  ${pc.dim('txray https://etherscan.io/tx/0xdef456...')}
  ${pc.dim('txray https://arbiscan.io/tx/0x789...')}
  ${pc.dim('txray 0xabc123... 137')}

${pc.yellow('SUPPORTED EXPLORERS:')}
  ${pc.dim('etherscan.io, polygonscan.com, arbiscan.io, optimistic.etherscan.io,')}
  ${pc.dim('basescan.org, bscscan.com, snowtrace.io, and more.')}
`);
}

main();
