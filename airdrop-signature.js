const { ethers } = require('ethers');
const { ApiPromise, WsProvider, Keyring } = require('@polkadot/api');
const { u8aToHex, hexToU8a, stringToU8a, u8aToString } = require('@polkadot/util');
const { encodeAddress, decodeAddress } = require('@polkadot/keyring');
const { blake2AsU8a } = require('@polkadot/util-crypto');

/**
 * Encodes a number as a u64 in little-endian format (SCALE encoding)
 * This mimics the Rust `.encode()` function for u64 types
 * @param {number} num - The number to encode
 * @returns {Uint8Array} - The encoded bytes
 */
function encodeU64(num) {
  // Create an 8-byte array (u64 = 8 bytes)
  const bytes = new Uint8Array(8);
  
  // Write the number in little-endian format (least significant byte first)
  bytes[0] = num & 0xFF;
  bytes[1] = (num >> 8) & 0xFF;
  bytes[2] = (num >> 16) & 0xFF;
  bytes[3] = (num >> 24) & 0xFF;
  bytes[4] = 0; // Higher bits are zero for numbers that fit in 32 bits
  bytes[5] = 0;
  bytes[6] = 0;
  bytes[7] = 0;
  
  return bytes;
}

/**
 * Converts binary data to ASCII-encoded hex
 * This mimics the to_ascii_hex function in the Rust pallet
 * @param {Uint8Array} data - The binary data to convert
 * @returns {Uint8Array} - ASCII-encoded hex representation
 */
function toAsciiHex(data) {
  const result = new Uint8Array(data.length * 2);
  
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    // First nibble
    const n1 = byte >> 4;
    result[i * 2] = n1 < 10 ? 48 + n1 : 97 + (n1 - 10); // '0' is 48, 'a' is 97 in ASCII
    
    // Second nibble
    const n2 = byte & 0x0F;
    result[i * 2 + 1] = n2 < 10 ? 48 + n2 : 97 + (n2 - 10);
  }
  
  return result;
}

/**
 * Creates an Ethereum signable message with the same format as the pallet
 * @param {Uint8Array} what - The main content to sign (typically the encoded account)
 * @param {Uint8Array} extra - Additional data (typically empty array)
 * @returns {Uint8Array} - The formatted message ready for signing
 */
function createEthereumSignableMessage(what, extra = new Uint8Array()) {
  // The prefix is hardcoded to match the one in the runtime
  const prefix = stringToU8a("Pay RUSTs to the TEST account:");
  
  // Calculate total length
  const length = prefix.length + what.length + extra.length;
  
  // Convert length to string and then to ASCII
  const lengthStr = length.toString();
  const lengthBytes = stringToU8a(lengthStr);
  
  // Construct the full message
  const header = stringToU8a("\x19Ethereum Signed Message:\n");
  
  // Concatenate all parts
  const messageBuffer = new Uint8Array(
    header.length + lengthBytes.length + prefix.length + what.length + extra.length
  );
  
  let offset = 0;
  messageBuffer.set(header, offset);
  offset += header.length;
  messageBuffer.set(lengthBytes, offset);
  offset += lengthBytes.length;
  messageBuffer.set(prefix, offset);
  offset += prefix.length;
  messageBuffer.set(what, offset);
  offset += what.length;
  messageBuffer.set(extra, offset);
  
  return messageBuffer;
}

/**
 * Generates a signature that can be used with the Airdrop pallet's claim function
 * @param {string} ethereumPrivateKey - Ethereum private key
 * @param {string|number} substrateAddress - Substrate address or account ID to claim tokens for
 * @returns {Promise<{signature: string, ethereumAddress: string}>}
 */
async function generateClaimSignature(ethereumPrivateKey, substrateAddress) {
  // Setup the Ethereum wallet (ethers v6 style)
  const wallet = new ethers.Wallet(ethereumPrivateKey);
  const ethereumAddress = wallet.address;
  
  // Connect to Substrate
  const api = await ApiPromise.create({
    provider: new WsProvider('wss://rpc.polkadot.io')
  });
  
  // Find the correct encoding for the substrate address
  let destAccount;
  
  // Check if substrateAddress is a number or numeric string
  if (!isNaN(substrateAddress)) {
    // It's a numeric account ID, encode it as a u64
    const accountId = parseInt(substrateAddress);
    destAccount = encodeU64(accountId);
    console.log(`Encoding numeric account ID: ${accountId}`);
  } else {
    try {
      // Try to decode as a substrate address
      const publicKey = decodeAddress(substrateAddress);
      destAccount = publicKey;
      console.log(`Decoded substrate address to public key`);
    } catch (error) {
      // If it fails, use the raw input
      destAccount = new Uint8Array(
        new TextEncoder().encode(substrateAddress)
      );
      console.log(`Using raw input as account identifier`);
    }
  }

  console.log(`destAccount: ${Array.from(destAccount)}`);
  
  // Convert account to ASCII hex
  const accountHexEncoded = toAsciiHex(destAccount);
  console.log(`accountHexEncoded: ${Array.from(accountHexEncoded)}`);
  
  // Create the signable message
  const message = createEthereumSignableMessage(accountHexEncoded);
  console.log(`ethereum_signable_message: ${message}`);
  
  // Hash the message with keccak256 (what the pallet does with the signable message)
  const messageHash = ethers.keccak256(message);
  console.log(`messageHash: ${ethers.getBytes(messageHash)}`);
  
  // In ethers v6, we need to use SigningKey directly
  const signingKey = new ethers.SigningKey(wallet.privateKey);
  
  // Sign the hash directly (this is what the Rust pallet does with libsecp256k1)
  const messageHashBytes = ethers.getBytes(messageHash);
  const signature = signingKey.sign(messageHashBytes);
  console.log(`signature: ${signature}`);

  // Create a 65-byte array (matching the [u8; 65] in Rust)
  const signatureBytes = new Uint8Array(65);
  
  // Fill with r bytes (first 32 bytes)
  const rBytes = ethers.getBytes(signature.r);
  signatureBytes.set(rBytes, 0);
  
  // Fill with s bytes (next 32 bytes)
  const sBytes = ethers.getBytes(signature.s);
  signatureBytes.set(sBytes, 32);
  
  // Set the recovery byte (last byte)
  // In Rust, recovery_id is 0 or 1, whereas in Ethereum v is usually 27 or 28
  signatureBytes[64] = signature.v === 27 ? 0 : 1;

  const finalSignature = Array.from(signatureBytes);
  console.log(`Final signature bytes: ${finalSignature}`);
  
  // Convert to hex for transmission
  const formattedSignature = ethers.hexlify(signatureBytes);
  console.log(`formattedSignature: ${formattedSignature}`);
  
  return {
    signature: `${formattedSignature}`,
    ethereumAddress
  };
}

// Example usage
async function main() {
  // Replace with a real Ethereum private key
  const ethereumPrivateKey = '0x9116d6c6a9c830c06af62af6d4101b566e2466d88510b6c11d655545c74790a4';
  
  // Replace with your Substrate address
  const substrateAccountId = 42; // Same account ID used in the Rust tests
  
  try {
    const { signature, ethereumAddress } = await generateClaimSignature(
      ethereumPrivateKey,
      substrateAccountId
    );
    
    console.log('Ethereum Address:', ethereumAddress);
    console.log('Claim Signature:', signature);
    console.log('');
    console.log('To claim tokens, you can call the airdrop.claim extrinsic with:');
    console.log('- dest:', substrateAccountId);
    console.log('- signature:', signature);
  } catch (error) {
    console.error('Error generating signature:', error);
  }
}

main().catch(console.error);