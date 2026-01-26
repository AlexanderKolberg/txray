import type { Hex } from 'viem';
import type { DecodeContext, DecodedData, Decoder } from '../src/decoder-registry.js';

const TRANSFER_SELECTOR = '0xa9059cbb';

export const exampleDecoder: Decoder = {
	name: 'example-erc20-transfer',
	priority: 10,

	match(data: Hex, _context: DecodeContext): boolean {
		return data.toLowerCase().startsWith(TRANSFER_SELECTOR);
	},

	decode(data: Hex, context: DecodeContext): DecodedData | null {
		if (data.length < 138) return null;

		const toAddress = `0x${data.slice(34, 74)}`;
		const amountHex = data.slice(74, 138);
		const amount = BigInt(`0x${amountHex}`);

		const toLabel = context.labels[toAddress.toLowerCase()];

		return {
			name: 'ERC20 Transfer',
			description: 'Transfer tokens to an address',
			params: [
				{
					name: 'to',
					type: 'address',
					value: toLabel ? `${toAddress} (${toLabel})` : toAddress,
				},
				{
					name: 'amount',
					type: 'uint256',
					value: amount,
				},
			],
		};
	},
};

export default exampleDecoder;
