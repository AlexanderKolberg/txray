import type { NetworkConfig } from '@0xsequence/network';
import pc from 'picocolors';
import {
	type Abi,
	createPublicClient,
	decodeFunctionResult,
	encodeFunctionData,
	formatEther,
	http,
	parseAbi,
} from 'viem';
import { loadLabels } from './labels.js';
import { getRpcUrl } from './networks.js';

export interface QueryOptions {
	labelsPath?: string;
	timeout?: number;
	block?: bigint | 'latest' | 'pending';
}

export interface QueryResult {
	address: string;
	function: string;
	args: unknown[];
	result: unknown;
	blockNumber?: bigint;
}

export async function queryContract(
	network: NetworkConfig,
	address: `0x${string}`,
	functionSig: string,
	args: string[],
	options: QueryOptions = {}
): Promise<QueryResult> {
	const timeout = options.timeout ?? 30000;
	const blockTag = options.block ?? 'latest';

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const functionAbi = parseAbi([`function ${functionSig}`] as never) as Abi;
	const functionName = functionSig.split('(')[0] ?? '';

	const parsedArgs = args.map((arg) => {
		if (arg.startsWith('0x')) return arg;
		if (arg === 'true') return true;
		if (arg === 'false') return false;
		if (/^\d+$/.test(arg)) return BigInt(arg);
		return arg;
	});

	const data = encodeFunctionData({
		abi: functionAbi,
		functionName,
		args: parsedArgs,
	} as never);

	const callParams =
		typeof blockTag === 'bigint'
			? { to: address, data, blockNumber: blockTag }
			: { to: address, data, blockTag };

	const result = await client.call(callParams as never);

	if (!result.data) {
		throw new Error('No data returned from call');
	}

	const decoded = decodeFunctionResult({
		abi: functionAbi,
		functionName,
		data: result.data,
	} as never);

	const currentBlock = await client.getBlockNumber();

	return {
		address,
		function: functionSig,
		args: parsedArgs,
		result: decoded,
		blockNumber: currentBlock,
	};
}

export async function getBalance(
	network: NetworkConfig,
	address: `0x${string}`,
	options: QueryOptions = {}
): Promise<{ balance: bigint; blockNumber: bigint }> {
	const timeout = options.timeout ?? 30000;
	const blockTag = options.block ?? 'latest';

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const balanceParams =
		typeof blockTag === 'bigint' ? { address, blockNumber: blockTag } : { address, blockTag };

	const balance = await client.getBalance(balanceParams as never);

	const blockNumber = await client.getBlockNumber();

	return { balance, blockNumber };
}

export async function getCode(
	network: NetworkConfig,
	address: `0x${string}`,
	options: QueryOptions = {}
): Promise<{ code: string; isContract: boolean; blockNumber: bigint }> {
	const timeout = options.timeout ?? 30000;
	const blockTag = options.block ?? 'latest';

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const codeParams =
		typeof blockTag === 'bigint' ? { address, blockNumber: blockTag } : { address, blockTag };

	const code = await client.getCode(codeParams as never);

	const blockNumber = await client.getBlockNumber();

	return {
		code: code ?? '0x',
		isContract: !!code && code !== '0x',
		blockNumber,
	};
}

export async function getStorageAt(
	network: NetworkConfig,
	address: `0x${string}`,
	slot: `0x${string}`,
	options: QueryOptions = {}
): Promise<{ value: string; blockNumber: bigint }> {
	const timeout = options.timeout ?? 30000;
	const blockTag = options.block ?? 'latest';

	const client = createPublicClient({
		transport: http(getRpcUrl(network), { timeout }),
	});

	const storageParams =
		typeof blockTag === 'bigint'
			? { address, slot, blockNumber: blockTag }
			: { address, slot, blockTag };

	const value = await client.getStorageAt(storageParams as never);

	const blockNumber = await client.getBlockNumber();

	return { value: value ?? '0x0', blockNumber };
}

function formatResult(result: unknown): string {
	if (typeof result === 'bigint') {
		const str = result.toString();
		if (result > 10n ** 15n && result < 10n ** 30n) {
			return `${pc.magenta(str)} ${pc.dim(`(${formatEther(result)} if 18 decimals)`)}`;
		}
		return pc.magenta(str);
	}
	if (typeof result === 'boolean') {
		return result ? pc.green('true') : pc.red('false');
	}
	if (typeof result === 'string' && result.startsWith('0x')) {
		return pc.cyan(result);
	}
	if (Array.isArray(result)) {
		return `[\n${result.map((v) => `    ${formatResult(v)}`).join(',\n')}\n  ]`;
	}
	return pc.white(String(result));
}

export async function queryCommand(args: string[]): Promise<void> {
	const { loadConfig } = await import('./config.js');
	const { getNetworkByChainId } = await import('./networks.js');
	const ora = (await import('ora')).default;

	const options: QueryOptions = {};
	const positional: string[] = [];
	let chainId: number | undefined;
	let subcommand: string | undefined;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;

		if (arg === '--chain' || arg === '-c') {
			const val = args[++i];
			chainId = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--block' || arg === '-b') {
			const val = args[++i];
			if (val === 'latest' || val === 'pending') {
				options.block = val;
			} else if (val) {
				options.block = BigInt(val);
			}
		} else if (arg === '--timeout' || arg === '-t') {
			const val = args[++i];
			options.timeout = val ? Number.parseInt(val, 10) : undefined;
		} else if (arg === '--labels' || arg === '-l') {
			options.labelsPath = args[++i];
		} else if (arg === '--help' || arg === '-h') {
			printQueryHelp();
			return;
		} else if (!arg.startsWith('-')) {
			if (!subcommand && ['balance', 'code', 'storage', 'call'].includes(arg)) {
				subcommand = arg;
			} else {
				positional.push(arg);
			}
		}
	}

	const config = loadConfig();
	chainId = chainId ?? config.defaultChain ?? 1;
	const network = getNetworkByChainId(chainId);
	const labels = loadLabels(options.labelsPath);

	if (!subcommand) {
		console.error(pc.red('Error: subcommand required (balance, code, storage, call)'));
		printQueryHelp();
		process.exit(1);
	}

	const address = positional[0] as `0x${string}` | undefined;
	if (!address || !address.startsWith('0x')) {
		console.error(pc.red('Error: valid address required'));
		printQueryHelp();
		process.exit(1);
	}

	const spinner = ora({ text: 'Querying...', color: 'cyan' }).start();

	try {
		const addressLabel = labels[address.toLowerCase()];
		const addressDisplay = addressLabel
			? `${address.slice(0, 12)}... ${pc.yellow(`(${addressLabel})`)}`
			: address;

		switch (subcommand) {
			case 'balance': {
				const result = await getBalance(network, address, options);
				spinner.succeed('Query complete');
				console.log('');
				console.log(`${pc.dim('Address:')} ${pc.white(addressDisplay)}`);
				console.log(`${pc.dim('Chain:')}   ${pc.cyan(network.title || network.name)}`);
				console.log(`${pc.dim('Block:')}   ${pc.white(String(result.blockNumber))}`);
				console.log(`${pc.dim('Balance:')} ${pc.yellow(formatEther(result.balance))} ETH`);
				break;
			}
			case 'code': {
				const result = await getCode(network, address, options);
				spinner.succeed('Query complete');
				console.log('');
				console.log(`${pc.dim('Address:')}     ${pc.white(addressDisplay)}`);
				console.log(`${pc.dim('Chain:')}       ${pc.cyan(network.title || network.name)}`);
				console.log(`${pc.dim('Block:')}       ${pc.white(String(result.blockNumber))}`);
				console.log(
					`${pc.dim('Is Contract:')} ${result.isContract ? pc.green('Yes') : pc.red('No')}`
				);
				if (result.isContract) {
					console.log(
						`${pc.dim('Code Size:')}   ${pc.white(`${(result.code.length - 2) / 2} bytes`)}`
					);
				}
				break;
			}
			case 'storage': {
				const slot = positional[1] as `0x${string}` | undefined;
				if (!slot || !slot.startsWith('0x')) {
					spinner.fail('Storage slot required');
					console.error(pc.red('Usage: txray query storage <address> <slot>'));
					process.exit(1);
				}
				const result = await getStorageAt(network, address, slot, options);
				spinner.succeed('Query complete');
				console.log('');
				console.log(`${pc.dim('Address:')} ${pc.white(addressDisplay)}`);
				console.log(`${pc.dim('Chain:')}   ${pc.cyan(network.title || network.name)}`);
				console.log(`${pc.dim('Block:')}   ${pc.white(String(result.blockNumber))}`);
				console.log(`${pc.dim('Slot:')}    ${pc.cyan(slot)}`);
				console.log(`${pc.dim('Value:')}   ${pc.magenta(result.value)}`);
				break;
			}
			case 'call': {
				const functionSig = positional[1];
				if (!functionSig) {
					spinner.fail('Function signature required');
					console.error(
						pc.red('Usage: txray query call <address> <function(args)> [arg1] [arg2]...')
					);
					process.exit(1);
				}
				const callArgs = positional.slice(2);
				const result = await queryContract(network, address, functionSig, callArgs, options);
				spinner.succeed('Query complete');
				console.log('');
				console.log(`${pc.dim('Address:')}  ${pc.white(addressDisplay)}`);
				console.log(`${pc.dim('Chain:')}    ${pc.cyan(network.title || network.name)}`);
				console.log(`${pc.dim('Block:')}    ${pc.white(String(result.blockNumber))}`);
				console.log(`${pc.dim('Function:')} ${pc.cyan(functionSig)}`);
				if (callArgs.length > 0) {
					console.log(`${pc.dim('Args:')}     ${pc.white(callArgs.join(', '))}`);
				}
				console.log(`${pc.dim('Result:')}   ${formatResult(result.result)}`);
				break;
			}
		}
	} catch (error) {
		spinner.fail('Query failed');
		console.error(pc.red((error as Error).message));
		process.exit(1);
	}
}

function printQueryHelp(): void {
	console.log(`
${pc.bold('txray query')} ${pc.dim('- Query on-chain state')}

${pc.yellow('USAGE:')}
  ${pc.cyan('txray query balance')} ${pc.dim('<address> [options]')}
  ${pc.cyan('txray query code')} ${pc.dim('<address> [options]')}
  ${pc.cyan('txray query storage')} ${pc.dim('<address> <slot> [options]')}
  ${pc.cyan('txray query call')} ${pc.dim('<address> <function(args)> [arg1] [arg2]... [options]')}

${pc.yellow('SUBCOMMANDS:')}
  ${pc.cyan('balance')}              Get ETH balance of address
  ${pc.cyan('code')}                 Check if address is a contract
  ${pc.cyan('storage')}              Read raw storage slot
  ${pc.cyan('call')}                 Call a contract function (read-only)

${pc.yellow('OPTIONS:')}
  ${pc.cyan('--help, -h')}           Show this help message
  ${pc.cyan('--chain, -c')} ${pc.dim('<id>')}     Chain ID (default: 1, or from config)
  ${pc.cyan('--block, -b')} ${pc.dim('<num>')}    Block number for historical query
  ${pc.cyan('--timeout, -t')} ${pc.dim('<ms>')}   Request timeout in milliseconds
  ${pc.cyan('--labels, -l')} ${pc.dim('<path>')}  Load address labels from a JSON file

${pc.yellow('EXAMPLES:')}
  ${pc.dim('txray query balance 0x1234...abcd')}
  ${pc.dim('txray query balance 0x1234...abcd --chain 137')}
  ${pc.dim('txray query code 0x1234...abcd')}
  ${pc.dim('txray query storage 0x1234...abcd 0x0')}
  ${pc.dim('txray query call 0x1234...abcd "balanceOf(address)" 0x5678...efgh')}
  ${pc.dim('txray query call 0x1234...abcd "name()" --block 18000000')}
  ${pc.dim('txray query call 0x1234...abcd "totalSupply()"')}

${pc.yellow('FUNCTION SIGNATURES:')}
  ${pc.dim('Use Solidity-style function signatures:')}
  ${pc.dim('  "balanceOf(address)"')}
  ${pc.dim('  "allowance(address,address)"')}
  ${pc.dim('  "name()"')}
  ${pc.dim('  "decimals()"')}
`);
}
