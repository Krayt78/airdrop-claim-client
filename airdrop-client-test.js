const { registerClaim } = require('./airdrop-register-claim.js');
const { generateClaimSignature } = require('./airdrop-signature.js');
const { submitSignature, verifyClaimResult } = require('./airdrop-claim.js');
const { cryptoWaitReady } = require('@polkadot/util-crypto');
const { WsProvider } = require('@polkadot/api');
const { ApiPromise } = require('@polkadot/api');
const { ethers } = require('ethers');

const WS_ENDPOINT = 'ws://127.0.0.1:9944';

async function connectToChain() {
    await cryptoWaitReady();
    const wsProvider = new WsProvider(WS_ENDPOINT);
    const api = await ApiPromise.create({
        provider: wsProvider,
        types: {
            EthereumAddress: '[u8; 20]',
            EcdsaSignature: '[u8; 65]'
        }
    });
    console.log('Connected to node');
    return api;
}

async function main() {
    const substrateAccountId = 42;
    const ethereumPrivateKey = '0x9116d6c6a9c830c06af62af6d4101b566e2466d88510b6c11d655545c74790a4';
    const wallet = new ethers.Wallet(ethereumPrivateKey);

    const api = await connectToChain();

    await registerClaim(api, wallet.address, 100);
    const { signature, ethereumAddress } = await generateClaimSignature(wallet.privateKey, substrateAccountId);
    const txHash = await submitSignature(api, wallet.address, substrateAccountId, signature);
    await verifyClaimResult(api, txHash);

    await api.disconnect();
}

main().catch(console.error);


