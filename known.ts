import {
	KNOWN_TOPICS as PRIVATE_TOPICS,
	KNOWN_CONTRACTS as PRIVATE_CONTRACTS,
} from './known-private';

export const KNOWN_TOPICS: Record<string, string> = {
	'0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer',
	'0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'Approval',
	'0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31': 'ApprovalForAll',
	'0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62': 'TransferSingle',
	'0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb': 'TransferBatch',
	'0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31': 'OrderFulfilled',
	'0x721c20121297512b72821b97f5326877ea8ecf4bb9948fea5bfcb6453074d37f': 'CounterIncremented',
	'0x5a589b1d8062f33451d29cae3dabd9b2e36c62aee644178c600977ca8dda661a': 'CallResult',
	'0x115f347c00e69f252cd6b63c4f81022a9564c6befe8aa719cb74640a4a306f0d': 'CallFailed',
	'0xc2c704302430fe0dc8d95f272e2f4e54bbbc51a3327fd5d75ab41f9fc8fd129b': 'CallAborted',
	'0x1f180c27086c7a39ea2a7b25239d1ab92348f07ca7bb59d1438fcf527568f881': 'OpExecuted',
	'0xed679328aebf74ede77ae09efcf36e90244f83643dadac1c2d9f0b21a46f6ab7': 'Sweep',
	'0x9ae934bf8a986157c889a24c3b3fa85e74b7e4ee4b1f8fc6e7362cb4c1d19d8b': 'CallSkipped',

	// Polygon
	'0x4dfe1bbbcf077ddc3e01291eea2d5c70c2b422b415d95645b9adcfd678cb1d63': 'LogFeeTransfer',

	// Private (not committed to repo)
	...PRIVATE_TOPICS,
};

export const KNOWN_CONTRACTS: Record<string, string> = {
	// Seaport
	'0x0000000000000068f116a894984e2db1123eb395': 'Seaport 1.6',
	'0x00000000000000adc04c56bf30ac9d3c0aaf14dc': 'Seaport 1.5',
	'0x00000000000001ad428e4906ae43d8f9852d0dd6': 'Seaport 1.4',

	// Conduits
	'0x1e0049783f008a0085193e00003d00cd54003c71': 'OpenSea Conduit',
	'0x2052f8a2ff46283b30084e5d84c89a2fdbe7f74b': 'Magic Eden Conduit',

	// Sequence Marketplace
	'0xb537a160472183f2150d42eb1c3dd6684a55f74c': 'Sequence Market V1',
	'0xfdb42a198a932c8d3b506ffa5e855bc4b348a712': 'Sequence Market V2',

	// Routers
	'0x0000000000006ac72ed1d192fa28f0058d3f8806': 'Universal Router',

	// WETH
	'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH (Mainnet)',
	'0x7ceb23fd6bc0add59e62ac25578270cff1b9f619': 'WETH (Polygon)',
	'0x4200000000000000000000000000000000000006': 'WETH (Base/OP)',

	// Chain-specific
	'0x0000000000000000000000000000000000001010': 'Polygon Fee',

	// Private (not committed to repo)
	...PRIVATE_CONTRACTS,
};
