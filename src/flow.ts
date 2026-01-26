import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import { createPublicClient, decodeEventLog, formatEther, formatUnits, http } from 'viem';
import { ALL_ABIS } from './abis.js';
import {
	DEFAULT_TIMEOUT_MS,
	ERC20_TRANSFER_TOPIC,
	ERC1155_BATCH_TOPIC,
	ERC1155_SINGLE_TOPIC,
} from './constants.js';
import { type Labels, loadLabels } from './labels.js';
import { getRpcUrl } from './networks.js';

export interface TokenTransfer {
	type: 'ERC20' | 'ERC721' | 'ERC1155';
	token: string;
	tokenLabel?: string;
	from: string;
	fromLabel?: string;
	to: string;
	toLabel?: string;
	amount?: bigint;
	tokenId?: bigint;
	tokenIds?: bigint[];
	amounts?: bigint[];
}

export interface NetBalance {
	address: string;
	label?: string;
	changes: Map<string, bigint>;
}

export interface FlowResult {
	txHash: string;
	transfers: TokenTransfer[];
	netBalances: NetBalance[];
	nativeValue: bigint;
	from: string;
	to: string | null;
}

export interface FlowOptions {
	labelsPath?: string;
	timeout?: number;
}

export async function analyzeFlow(
	network: NetworkConfig,
	txHash: `0x${string}`,
	options: FlowOptions = {}
): Promise<FlowResult> {
	const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
	const labels = loadLabels(options.labelsPath);

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const [tx, receipt] = await Promise.all([
		client.getTransaction({ hash: txHash }),
		client.getTransactionReceipt({ hash: txHash }),
	]);

	const transfers: TokenTransfer[] = [];

	for (const log of receipt.logs) {
		const topic0 = log.topics[0];
		if (!topic0) continue;

		if (topic0 === ERC20_TRANSFER_TOPIC) {
			const transfer = parseERC20Transfer(log, labels);
			if (transfer) transfers.push(transfer);
		} else if (topic0 === ERC1155_SINGLE_TOPIC) {
			const transfer = parseERC1155Single(log, labels);
			if (transfer) transfers.push(transfer);
		} else if (topic0 === ERC1155_BATCH_TOPIC) {
			const transfer = parseERC1155Batch(log, labels);
			if (transfer) transfers.push(transfer);
		}
	}

	const netBalances = calculateNetBalances(transfers, labels);

	return {
		txHash,
		transfers,
		netBalances,
		nativeValue: tx.value,
		from: tx.from,
		to: tx.to,
	};
}

interface LogWithTopics {
	address: string;
	topics: readonly string[];
	data: string;
}

function parseERC20Transfer(log: LogWithTopics, labels: Labels): TokenTransfer | null {
	try {
		if (log.topics.length === 3) {
			const from = `0x${log.topics[1]?.slice(26)}`;
			const to = `0x${log.topics[2]?.slice(26)}`;
			const amount = BigInt(log.data || '0x0');

			return {
				type: 'ERC20',
				token: log.address,
				tokenLabel: labels[log.address.toLowerCase()],
				from,
				fromLabel: labels[from.toLowerCase()],
				to,
				toLabel: labels[to.toLowerCase()],
				amount,
			};
		}

		if (log.topics.length === 4) {
			const from = `0x${log.topics[1]?.slice(26)}`;
			const to = `0x${log.topics[2]?.slice(26)}`;
			const tokenId = BigInt(log.topics[3] || '0x0');

			return {
				type: 'ERC721',
				token: log.address,
				tokenLabel: labels[log.address.toLowerCase()],
				from,
				fromLabel: labels[from.toLowerCase()],
				to,
				toLabel: labels[to.toLowerCase()],
				tokenId,
			};
		}
	} catch {
		return null;
	}
	return null;
}

function parseERC1155Single(log: LogWithTopics, labels: Labels): TokenTransfer | null {
	try {
		const decoded = decodeEventLog({
			abi: ALL_ABIS,
			data: log.data as `0x${string}`,
			topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
		});

		if (decoded.eventName === 'TransferSingle') {
			const args = decoded.args as unknown as {
				from: string;
				to: string;
				id: bigint;
				value: bigint;
			};
			return {
				type: 'ERC1155',
				token: log.address,
				tokenLabel: labels[log.address.toLowerCase()],
				from: args.from,
				fromLabel: labels[args.from.toLowerCase()],
				to: args.to,
				toLabel: labels[args.to.toLowerCase()],
				tokenId: args.id,
				amount: args.value,
			};
		}
	} catch {
		return null;
	}
	return null;
}

function parseERC1155Batch(log: LogWithTopics, labels: Labels): TokenTransfer | null {
	try {
		const decoded = decodeEventLog({
			abi: ALL_ABIS,
			data: log.data as `0x${string}`,
			topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
		});

		if (decoded.eventName === 'TransferBatch') {
			const args = decoded.args as unknown as {
				from: string;
				to: string;
				ids: readonly bigint[];
				values: readonly bigint[];
			};
			return {
				type: 'ERC1155',
				token: log.address,
				tokenLabel: labels[log.address.toLowerCase()],
				from: args.from,
				fromLabel: labels[args.from.toLowerCase()],
				to: args.to,
				toLabel: labels[args.to.toLowerCase()],
				tokenIds: [...args.ids],
				amounts: [...args.values],
			};
		}
	} catch {
		return null;
	}
	return null;
}

function calculateNetBalances(transfers: TokenTransfer[], labels: Labels): NetBalance[] {
	const balanceMap = new Map<string, Map<string, bigint>>();

	function updateBalance(address: string, token: string, delta: bigint): void {
		const addrLower = address.toLowerCase();
		if (!balanceMap.has(addrLower)) {
			balanceMap.set(addrLower, new Map());
		}
		const tokenMap = balanceMap.get(addrLower);
		if (!tokenMap) return;
		const current = tokenMap.get(token) ?? 0n;
		tokenMap.set(token, current + delta);
	}

	for (const transfer of transfers) {
		if (transfer.type === 'ERC20' && transfer.amount !== undefined) {
			updateBalance(transfer.from, transfer.token, -transfer.amount);
			updateBalance(transfer.to, transfer.token, transfer.amount);
		}
	}

	const result: NetBalance[] = [];
	for (const [address, changes] of balanceMap) {
		const hasChanges = Array.from(changes.values()).some((v) => v !== 0n);
		if (hasChanges) {
			result.push({
				address,
				label: labels[address],
				changes,
			});
		}
	}

	return result.sort((a, b) => {
		const aTotal = Array.from(a.changes.values()).reduce((sum, v) => sum + (v > 0n ? v : -v), 0n);
		const bTotal = Array.from(b.changes.values()).reduce((sum, v) => sum + (v > 0n ? v : -v), 0n);
		return bTotal > aTotal ? 1 : -1;
	});
}

export function formatFlow(result: FlowResult, labels: Labels): string {
	const lines: string[] = [];
	const hr = pc.dim('─'.repeat(70));

	lines.push(hr);
	lines.push(pc.bold('FUND FLOW'));
	lines.push(hr);
	lines.push('');
	lines.push(`${pc.dim('Tx:')}       ${result.txHash.slice(0, 18)}...`);
	lines.push(`${pc.dim('From:')}     ${formatAddress(result.from, labels)}`);
	lines.push(
		`${pc.dim('To:')}       ${result.to ? formatAddress(result.to, labels) : pc.dim('(contract creation)')}`
	);

	if (result.nativeValue > 0n) {
		lines.push(`${pc.dim('Value:')}    ${pc.yellow(formatEther(result.nativeValue))} ETH`);
	}

	lines.push('');
	lines.push(hr);
	lines.push(`${pc.bold('TOKEN TRANSFERS')} ${pc.dim(`(${result.transfers.length})`)}`);
	lines.push(hr);
	lines.push('');

	if (result.transfers.length === 0) {
		lines.push(pc.dim('  No token transfers detected'));
	} else {
		for (const transfer of result.transfers) {
			const tokenDisplay = transfer.tokenLabel
				? pc.cyan(transfer.tokenLabel)
				: pc.white(`${transfer.token.slice(0, 12)}...`);

			if (transfer.type === 'ERC20') {
				const amount = formatUnits(transfer.amount ?? 0n, 18);
				lines.push(`  ${pc.green(transfer.type)} ${tokenDisplay}`);
				lines.push(
					`    ${formatAddress(transfer.from, labels)} ${pc.dim('→')} ${formatAddress(transfer.to, labels)}`
				);
				lines.push(`    ${pc.yellow(amount)} tokens`);
			} else if (transfer.type === 'ERC721') {
				lines.push(`  ${pc.magenta(transfer.type)} ${tokenDisplay}`);
				lines.push(
					`    ${formatAddress(transfer.from, labels)} ${pc.dim('→')} ${formatAddress(transfer.to, labels)}`
				);
				lines.push(`    Token ID: ${pc.cyan(String(transfer.tokenId))}`);
			} else if (transfer.type === 'ERC1155') {
				lines.push(`  ${pc.blue(transfer.type)} ${tokenDisplay}`);
				lines.push(
					`    ${formatAddress(transfer.from, labels)} ${pc.dim('→')} ${formatAddress(transfer.to, labels)}`
				);
				if (transfer.tokenId !== undefined) {
					lines.push(
						`    Token ID: ${pc.cyan(String(transfer.tokenId))} x${transfer.amount ?? 1n}`
					);
				} else if (transfer.tokenIds) {
					lines.push(`    ${pc.cyan(String(transfer.tokenIds.length))} token types transferred`);
				}
			}
			lines.push('');
		}
	}

	if (result.netBalances.length > 0) {
		lines.push(hr);
		lines.push(pc.bold('NET BALANCE CHANGES'));
		lines.push(hr);
		lines.push('');

		for (const balance of result.netBalances.slice(0, 10)) {
			const addressDisplay = balance.label
				? `${balance.address.slice(0, 12)}... ${pc.yellow(`(${balance.label})`)}`
				: `${balance.address.slice(0, 20)}...`;

			lines.push(`  ${pc.white(addressDisplay)}`);

			for (const [token, change] of balance.changes) {
				if (change === 0n) continue;
				const tokenLabel = labels[token.toLowerCase()];
				const tokenDisplay = tokenLabel || `${token.slice(0, 10)}...`;
				const changeStr = formatUnits(change, 18);
				const color = change > 0n ? pc.green : pc.red;
				const sign = change > 0n ? '+' : '';
				lines.push(`    ${pc.dim(tokenDisplay)}: ${color(`${sign}${changeStr}`)}`);
			}
			lines.push('');
		}
	}

	lines.push(hr);

	return lines.join('\n');
}

function formatAddress(address: string, labels: Labels): string {
	const label = labels[address.toLowerCase()];
	if (label) {
		return `${pc.white(address.slice(0, 10))}... ${pc.yellow(`(${label})`)}`;
	}
	return pc.white(`${address.slice(0, 14)}...`);
}

export async function flowCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId, parseExplorerUrl } = await import('./networks.js');
	const ora = (await import('ora')).default;

	const options: FlowOptions = {};
	const positional: string[] = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--labels' || arg === '-l') {
			options.labelsPath = args[++i];
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			options.timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--help' || arg === '-h') {
			printFlowHelp();
			return;
		} else if (!arg.startsWith('-')) {
			positional.push(arg);
		}
	}

	const input = positional[0];
	if (!input) {
		console.error(pc.red('Error: transaction hash or URL required'));
		printFlowHelp();
		process.exit(1);
	}

	let txHash: `0x${string}`;
	let chainId: number;

	if (input.startsWith('http')) {
		const parsed = parseExplorerUrl(input);
		txHash = parsed.txHash;
		chainId = parsed.chainId;
	} else if (input.startsWith('0x')) {
		const config = loadConfig();
		txHash = input.toLowerCase() as `0x${string}`;
		const chainArg = positional[1];
		chainId = chainArg ? Number.parseInt(chainArg, 10) : (config.defaultChain ?? 1);
	} else {
		console.error(pc.red('Invalid input. Provide a block explorer URL or tx hash.'));
		process.exit(1);
	}

	const network = getNetworkByChainId(chainId);
	const labels = loadLabels(options.labelsPath);

	const spinner = ora({
		text: `Analyzing fund flow for ${txHash.slice(0, 10)}...`,
		color: 'cyan',
	}).start();

	try {
		const result = await analyzeFlow(network, txHash, options);
		spinner.succeed('Fund flow analysis complete');
		console.log('');
		console.log(formatFlow(result, labels));
	} catch (error) {
		spinner.fail('Fund flow analysis failed');
		console.error(pc.red((error as Error).message));
		process.exit(1);
	}
}

function printFlowHelp(): void {
	console.log(`
${pc.bold('txray flow')} ${pc.dim('- Analyze token transfers and fund flow')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray flow')} ${pc.dim('<tx-url-or-hash> [chain-id] [options]')}

${pc.yellow('ARGUMENTS:')}
  ${pc.cyan('<tx>')}                  Transaction URL or hash
  ${pc.cyan('[chain-id]')}            Chain ID (default: 1, or from config)

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}            Show this help message
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}    Request timeout in milliseconds
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}   Load address labels from a JSON file

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray flow https://etherscan.io/tx/0x123...')}
  ${pc.dim('txray flow 0x123... 1')}
  ${pc.dim('txray flow 0x123... --labels ./my-labels.json')}

${pc.yellow('DETECTS:')}
  ${pc.dim('- ERC20 token transfers')}
  ${pc.dim('- ERC721 NFT transfers')}
  ${pc.dim('- ERC1155 multi-token transfers')}
  ${pc.dim('- Native ETH value transfers')}

${pc.yellow('OUTPUT INCLUDES:')}
  ${pc.dim('- Individual token transfers with from/to addresses')}
  ${pc.dim('- Net balance changes per address')}
`);
}
