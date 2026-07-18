const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((character, index) => [character, index]));
const BASE58_CANDIDATE =
  /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;

function decodeBase58(value: string): Uint8Array | undefined {
  const bytes = [0];

  for (const character of value) {
    const digit = BASE58_INDEX.get(character);
    if (digit === undefined) return undefined;

    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) {
      const next = (bytes[index] ?? 0) * 58 + carry;
      bytes[index] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroes = 0;
  while (leadingZeroes < value.length - 1 && value[leadingZeroes] === "1") {
    bytes.push(0);
    leadingZeroes += 1;
  }

  return Uint8Array.from(bytes.reverse());
}

export function isSolanaAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44) return false;
  return decodeBase58(value)?.length === 32;
}

export function extractSolanaAddress(text: string): string | undefined {
  for (const candidate of text.matchAll(BASE58_CANDIDATE)) {
    const value = candidate[0];
    if (isSolanaAddress(value)) return value;
  }
  return undefined;
}
