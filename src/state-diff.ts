import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import { createPublicClient, http } from 'viem';
import { type Labels, loadLabels } from './labels.js';
import { getRpcUrl } from './networks.js';

export interface StorageChange {
	slot: string;
	before: string;
	after: string;
}

export interface AccountDiff {
	address: string;
	balance?: { before: string; after: string };
	nonce?: { before: string; after: string };
	code?: { before: string; after: string };
	storage: StorageChange[];
}

export interface StateDiffResult {
	txHash: string;
	accounts: AccountDiff[];
	totalChanges: number;
}

export interface StateDiffOptions {
	labelsPath?: string;
	timeout?: number;
}

interface PreStateAccount {
	balance?: string;
	nonce?: number;
	code?: string;
	storage?: Record<string, string>;
}

interface DiffStateResult {
	pre: { [address: string]: PreStateAccount };
	post: { [address: string]: PreStateAccount };
}

export async function getStateDiff(
	network: NetworkConfig,
	txHash: `0x${string}`,
	options: StateDiffOptions = {}
): Promise<StateDiffResult> {
	const timeout = options.timeout ?? 30000;

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const diffResult = (await client.request({
		method: 'debug_traceTransaction' as never,
		params: [txHash, { tracer: 'prestateTracer', tracerConfig: { diffMode: true } }] as never,
	})) as DiffStateResult;

	const accounts = parseStateDiff(diffResult);

	return {
		txHash,
		accounts,
		totalChanges: accounts.reduce(
			(sum, acc) => sum + acc.storage.length + (acc.balance ? 1 : 0) + (acc.nonce ? 1 : 0),
			0
		),
	};
}

function parseStateDiff(diff: DiffStateResult): AccountDiff[] {
	const accounts: AccountDiff[] = [];
	const allAddresses = new Set([...Object.keys(diff.pre || {}), ...Object.keys(diff.post || {})]);

	for (const address of allAddresses) {
		const pre = diff.pre?.[address] || {};
		const post = diff.post?.[address] || {};

		const accountDiff: AccountDiff = {
			address,
			storage: [],
		};

		if (pre.balance !== post.balance) {
			accountDiff.balance = {
				before: pre.balance || '0x0',
				after: post.balance || '0x0',
			};
		}

		if (pre.nonce !== post.nonce) {
			accountDiff.nonce = {
				before: String(pre.nonce ?? 0),
				after: String(post.nonce ?? 0),
			};
		}

		if (pre.code !== post.code) {
			accountDiff.code = {
				before: pre.code || '0x',
				after: post.code || '0x',
			};
		}

		const allSlots = new Set([
			...Object.keys(pre.storage || {}),
			...Object.keys(post.storage || {}),
		]);
		for (const slot of allSlots) {
			const beforeVal = pre.storage?.[slot] || '0x0';
			const afterVal = post.storage?.[slot] || '0x0';
			if (beforeVal !== afterVal) {
				accountDiff.storage.push({
					slot,
					before: beforeVal,
					after: afterVal,
				});
			}
		}

		if (
			accountDiff.balance ||
			accountDiff.nonce ||
			accountDiff.code ||
			accountDiff.storage.length > 0
		) {
			accounts.push(accountDiff);
		}
	}

	return accounts;
}

export function formatStateDiff(result: StateDiffResult, labels: Labels): string {
	const lines: string[] = [];
	const hr = pc.dim('─'.repeat(70));

	lines.push(hr);
	lines.push(pc.bold('STATE DIFF'));
	lines.push(hr);
	lines.push('');
	lines.push(`${pc.dim('Tx:')}            ${result.txHash.slice(0, 18)}...`);
	lines.push(`${pc.dim('Accounts:')}      ${pc.cyan(String(result.accounts.length))}`);
	lines.push(`${pc.dim('Total Changes:')} ${pc.yellow(String(result.totalChanges))}`);
	lines.push('');

	for (const account of result.accounts) {
		const label = labels[account.address.toLowerCase()];
		const addressDisplay = label
			? `${account.address} ${pc.yellow(`(${label})`)}`
			: account.address;

		lines.push(hr);
		lines.push(`${pc.bold('Account:')} ${pc.white(addressDisplay)}`);
		lines.push('');

		if (account.balance) {
			const beforeEth = formatWei(account.balance.before);
			const afterEth = formatWei(account.balance.after);
			const diff = BigInt(account.balance.after) - BigInt(account.balance.before);
			const diffStr =
				diff >= 0n
					? `+${formatWei(`0x${diff.toString(16)}`)}`
					: formatWei(`0x${(-diff).toString(16)}`);
			const diffColor = diff >= 0n ? pc.green : pc.red;

			lines.push(`  ${pc.dim('Balance:')}`);
			lines.push(`    ${pc.red(`- ${beforeEth}`)}`);
			lines.push(`    ${pc.green(`+ ${afterEth}`)} ${diffColor(`(${diffStr})`)}`);
		}

		if (account.nonce) {
			lines.push(`  ${pc.dim('Nonce:')}`);
			lines.push(`    ${pc.red(`- ${account.nonce.before}`)}`);
			lines.push(`    ${pc.green(`+ ${account.nonce.after}`)}`);
		}

		if (account.code) {
			const beforeLen = (account.code.before.length - 2) / 2;
			const afterLen = (account.code.after.length - 2) / 2;
			lines.push(`  ${pc.dim('Code:')}`);
			lines.push(`    ${pc.red(`- ${beforeLen} bytes`)}`);
			lines.push(`    ${pc.green(`+ ${afterLen} bytes`)}`);
		}

		if (account.storage.length > 0) {
			lines.push(`  ${pc.dim('Storage:')} ${pc.cyan(`(${account.storage.length} slots)`)}`);
			for (const change of account.storage.slice(0, 20)) {
				lines.push(`    ${pc.dim('slot')} ${pc.cyan(truncateHex(change.slot, 16))}`);
				lines.push(`      ${pc.red(`- ${truncateHex(change.before, 32)}`)}`);
				lines.push(`      ${pc.green(`+ ${truncateHex(change.after, 32)}`)}`);
			}
			if (account.storage.length > 20) {
				lines.push(`    ${pc.dim(`... and ${account.storage.length - 20} more slots`)}`);
			}
		}

		lines.push('');
	}

	lines.push(hr);

	return lines.join('\n');
}

function formatWei(hex: string): string {
	const value = BigInt(hex);
	if (value === 0n) return '0 ETH';
	const eth = Number(value) / 1e18;
	if (eth < 0.0001) {
		return `${value.toString()} wei`;
	}
	return `${eth.toFixed(6)} ETH`;
}

function truncateHex(hex: string, maxLen: number): string {
	if (hex.length <= maxLen + 2) return hex;
	return `${hex.slice(0, maxLen + 2)}...`;
}

export function isStateDiffSupported(error: Error): boolean {
	const message = error.message.toLowerCase();
	return !(
		message.includes('method not found') ||
		message.includes('not supported') ||
		message.includes('debug_tracetransaction') ||
		message.includes('unsupported method') ||
		message.includes('prestate')
	);
}

export async function stateDiffCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId, parseExplorerUrl } = await import('./networks.js');
	const ora = (await import('ora')).default;

	const options: StateDiffOptions = {};
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
			printStateDiffHelp();
			return;
		} else if (!arg.startsWith('-')) {
			positional.push(arg);
		}
	}

	const input = positional[0];
	if (!input) {
		console.error(pc.red('Error: transaction hash or URL required'));
		printStateDiffHelp();
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
		text: `Getting state diff for ${txHash.slice(0, 10)}...`,
		color: 'cyan',
	}).start();

	try {
		const result = await getStateDiff(network, txHash, options);
		spinner.succeed('State diff complete');
		console.log('');
		console.log(formatStateDiff(result, labels));
	} catch (error) {
		const err = error as Error;
		if (!isStateDiffSupported(err)) {
			spinner.fail('State diff not supported by this RPC');
			console.error(pc.dim('This RPC node does not support prestateTracer.'));
			console.error(
				pc.dim('Try using an archive node or a service like Alchemy/Infura with tracing enabled.')
			);
		} else {
			spinner.fail('State diff failed');
			console.error(pc.red(err.message));
		}
		process.exit(1);
	}
}

function printStateDiffHelp(): void {
	console.log(`
${pc.bold('txray state-diff')} ${pc.dim('- Show storage changes before/after transaction')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray state-diff')} ${pc.dim('<tx-url-or-hash> [chain-id] [options]')}

${pc.yellow('ARGUMENTS:')}
  ${pc.cyan('<tx>')}                  Transaction URL or hash
  ${pc.cyan('[chain-id]')}            Chain ID (default: 1, or from config)

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}            Show this help message
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}    Request timeout in milliseconds
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}   Load address labels from a JSON file

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray state-diff https://etherscan.io/tx/0x123...')}
  ${pc.dim('txray state-diff 0x123... 1')}
  ${pc.dim('txray state-diff 0x123... --labels ./my-labels.json')}

${pc.yellow('OUTPUT INCLUDES:')}
  ${pc.dim('- Balance changes per account')}
  ${pc.dim('- Nonce changes')}
  ${pc.dim('- Code changes (contract deployment)')}
  ${pc.dim('- Storage slot changes with before/after values')}

${pc.yellow('NOTE:')}
  ${pc.dim('Requires an RPC that supports debug_traceTransaction with prestateTracer.')}
`);
}
