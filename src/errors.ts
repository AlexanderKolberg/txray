export const COMMON_ERRORS_ABI = [
	{ type: 'error', name: 'Error', inputs: [{ name: 'message', type: 'string' }] },
	{ type: 'error', name: 'Panic', inputs: [{ name: 'code', type: 'uint256' }] },
] as const;
