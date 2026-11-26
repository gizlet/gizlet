/** RSA private keys in PEM, for signing GitHub App JWTs with Web Crypto. No imports, so unit tests load it directly. */

/** Import a PEM RSA key. GitHub hands out PKCS#1 ("RSA PRIVATE KEY"); Web Crypto wants PKCS#8. */
export async function importRsaKey(pem: string): Promise<CryptoKey> {
  const pkcs1 = /-----BEGIN RSA PRIVATE KEY-----/.test(pem);
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (ch) => ch.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", pkcs1 ? pkcs1ToPkcs8(der) : der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** PrivateKeyInfo { version 0, AlgorithmIdentifier rsaEncryption, OCTET STRING pkcs1 }. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octets = [0x04, ...derLength(pkcs1.length)];
  const bodyLength = version.length + algorithm.length + octets.length + pkcs1.length;
  const head = [0x30, ...derLength(bodyLength), ...version, ...algorithm, ...octets];
  const out = new Uint8Array(head.length + pkcs1.length);
  out.set(head, 0);
  out.set(pkcs1, head.length);
  return out;
}
