#!/usr/bin/env bun
import ora from 'ora';
import pc from 'picocolors';
import { type DebugResult, debugTransaction, formatDebugResult } from './debug.js';
import { decodeCommand } from './decode.js';
import { getNetworkByChainId, parseExplorerUrl } from './networks.js';
import { selectorCommand } from './selectors.js';

const VERSION = '1.0.0';

interface ParsedArgs {
	positional: string[];
	labels?: string;
	json: boolean;
	help: boolean;
	version: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
	const result: ParsedArgs = { positional: [], json: false, help: false, version: false };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--labels' || arg === '-l') {
			result.labels = args[++i];
		} else if (arg.startsWith('--labels=')) {
			result.labels = arg.slice('--labels='.length);
		} else if (arg === '--json' || arg === '-j') {
			result.json = true;
		} else if (arg === '--help' || arg === '-h') {
			result.help = true;
		} else if (arg === '--version' || arg === '-v') {
			result.version = true;
		} else if (!arg.startsWith('-')) {
			result.positional.push(arg);
		}
	}

	return result;
}

const SUBCOMMANDS: Record<string, (args: string[]) => Promise<void>> = {
	selector: selectorCommand,
	decode: decodeCommand,
};

function formatJsonResult(result: DebugResult): string {
	const jsonOutput = {
		network: {
			name: result.network.name,
			chainId: result.network.chainId,
		},
		txHash: result.txHash,
		status: result.status,
		blockNumber: String(result.blockNumber),
		timestamp: result.timestamp.toISOString(),
		from: result.from,
		to: result.to,
		value: String(result.value),
		gasUsed: String(result.gasUsed),
		logs: result.logs.map((log) => ({
			index: log.index,
			address: log.address,
			addressLabel: log.addressLabel,
			eventName: log.eventName,
			topics: log.topics,
			data: log.data,
			decoded: log.decoded
				? Object.fromEntries(
						Object.entries(log.decoded).map(([k, v]) => [k, typeof v === 'bigint' ? String(v) : v])
					)
				: undefined,
		})),
		errors: result.errors,
		links: result.links,
	};
	return JSON.stringify(jsonOutput, null, 2);
}

async function main() {
	const args = process.argv.slice(2);
	const firstArg = args[0];

	if (firstArg === '--help' || firstArg === '-h' || (!firstArg && args.length === 0)) {
		printUsage();
		return;
	}

	if (firstArg === '--version' || firstArg === '-v') {
		console.log(`txray v${VERSION}`);
		return;
	}

	if (firstArg && SUBCOMMANDS[firstArg]) {
		await SUBCOMMANDS[firstArg](args.slice(1));
		return;
	}

	const parsed = parseArgs(args);

	if (parsed.help) {
		printUsage();
		return;
	}

	if (parsed.version) {
		console.log(`txray v${VERSION}`);
		return;
	}

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
			if (!parsed.json) {
				console.log(
					`${pc.dim('Chain:')} ${pc.cyan(parsedUrl.network.title ?? parsedUrl.network.name)} ${pc.dim(`(${chainId})`)}`
				);
			}
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

		let result: DebugResult;

		if (parsed.json) {
			result = await debugTransaction(network, txHash, { labelsPath: parsed.labels });
			console.log(formatJsonResult(result));
		} else {
			const spinner = ora({
				text: `Fetching ${txHash.slice(0, 10)}...`,
				color: 'cyan',
			}).start();

			try {
				result = await debugTransaction(network, txHash, { labelsPath: parsed.labels });
				spinner.succeed('Transaction fetched');
				console.log('');
				console.log(formatDebugResult(result));
			} catch (error) {
				spinner.fail('Failed to fetch transaction');
				throw error;
			}
		}
	} catch (error) {
		if (!parseArgs(args).json) {
			console.error(`${pc.red('Error:')} ${(error as Error).message}`);
		} else {
			console.error(JSON.stringify({ error: (error as Error).message }));
		}
		process.exit(1);
	}
}

function printUsage() {
	console.log(`
${pc.bold('txray')} ${pc.dim(`v${VERSION}`)} ${pc.dim('- X-ray for EVM transactions')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray')} ${pc.dim('<explorer-url> [options]')}
  ${pc.cyan('txray')} ${pc.dim('<tx-hash> [chain-id] [options]')}
  ${pc.cyan('txray selector')} ${pc.dim('<0x...>')}
  ${pc.cyan('txray decode')} ${pc.dim('<calldata> | --tx <hash>')}

${pc.yellow('COMMANDS:')}
  ${pc.cyan('selector')} ${pc.dim('<0x...>')}         Look up function signature by 4-byte selector
  ${pc.cyan('decode')} ${pc.dim('<calldata>')}        Decode calldata using loaded ABIs
  ${pc.cyan('decode')} ${pc.dim('--tx <hash>')}       Decode calldata from transaction

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}            Show this help message
  ${pc.cyan('--version, -v')}         Show version number
  ${pc.cyan('--json, -j')}            Output in JSON format
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}   Load address labels from a JSON file

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray https://polygonscan.com/tx/0xabc123...')}
  ${pc.dim('txray https://etherscan.io/tx/0xdef456...')}
  ${pc.dim('txray https://arbiscan.io/tx/0x789...')}
  ${pc.dim('txray 0xabc123... 137')}
  ${pc.dim('txray 0xabc123... 1 --json')}
  ${pc.dim('txray 0xabc123... 1 --labels ./my-labels.json')}
  ${pc.dim('txray selector 0xa9059cbb')}
  ${pc.dim('txray decode 0xa9059cbb000000000000...')}
  ${pc.dim('txray decode --tx 0xabc123... --chain 1')}

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
