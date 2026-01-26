#!/usr/bin/env bun
import pc from 'picocolors';
import { debugTransaction, formatDebugResult } from './debug.js';
import { getNetworkByChainId, parseExplorerUrl } from './networks.js';

interface ParsedArgs {
	positional: string[];
	labels?: string;
}

function parseArgs(args: string[]): ParsedArgs {
	const result: ParsedArgs = { positional: [] };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--labels' || arg === '-l') {
			result.labels = args[++i];
		} else if (arg.startsWith('--labels=')) {
			result.labels = arg.slice('--labels='.length);
		} else if (!arg.startsWith('-')) {
			result.positional.push(arg);
		}
	}

	return result;
}

async function main() {
	const parsed = parseArgs(process.argv.slice(2));
	const input = parsed.positional[0];

	if (!input) {
		printUsage();
		process.exit(1);
	}

	try {
		let txHash: `0x${string}`;
		let chainId: number;

		if (input.startsWith('http')) {
			const parsedUrl = parseExplorerUrl(input);
			txHash = parsedUrl.txHash;
			chainId = parsedUrl.chainId;
			console.log(
				`${pc.dim('Chain:')} ${pc.cyan(parsedUrl.network.title ?? parsedUrl.network.name)} ${pc.dim(`(${chainId})`)}`
			);
		} else if (input.startsWith('0x')) {
			txHash = input.toLowerCase() as `0x${string}`;
			const chainArg = parsed.positional[1];
			chainId = chainArg ? parseInt(chainArg, 10) : 1;
			if (Number.isNaN(chainId)) {
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

		const result = await debugTransaction(network, txHash, { labelsPath: parsed.labels });
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
  ${pc.cyan('txray')} ${pc.dim('<explorer-url> [options]')}
  ${pc.cyan('txray')} ${pc.dim('<tx-hash> [chain-id] [options]')}

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}  Load address labels from a JSON file

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray https://polygonscan.com/tx/0xabc123...')}
  ${pc.dim('txray https://etherscan.io/tx/0xdef456...')}
  ${pc.dim('txray https://arbiscan.io/tx/0x789...')}
  ${pc.dim('txray 0xabc123... 137')}
  ${pc.dim('txray 0xabc123... 1 --labels ./my-labels.json')}

${pc.yellow('LABELS:')}
  ${pc.dim('Address labels are loaded from (in priority order):')}
  ${pc.dim('  1. Built-in labels (Seaport, WETH, etc.)')}
  ${pc.dim('  2. ~/.config/txray/labels.json')}
  ${pc.dim('  3. ./labels.json')}
  ${pc.dim('  4. --labels <path> (if provided)')}

${pc.yellow('SUPPORTED EXPLORERS:')}
  ${pc.dim('etherscan.io, polygonscan.com, arbiscan.io, optimistic.etherscan.io,')}
  ${pc.dim('basescan.org, bscscan.com, snowtrace.io, and more.')}
`);
}

main();
