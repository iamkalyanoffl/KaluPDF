import * as asn1js from 'asn1js'
import { ContentInfo, SignedData, Certificate, CertificateChainValidationEngine, getCrypto, setEngine, CryptoEngine } from 'pkijs'
export interface SigResult { index: number; status: 'intact' | 'invalid' | 'unreadable'; detail: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cn = (n: any): string => n.typesAndValues.find((t: any) => t.type === '2.5.4.3')?.value.valueBlock.value ?? n.typesAndValues.map((t: any) => t.value.valueBlock.value).join(', ')
const day = (d: Date) => d.toISOString().slice(0, 10)
export const TRUST = 'Intact means the file has not changed since it was signed and the signature matches the certificate stored inside it. Unless you supply a trusted root certificate below, the certificate is not checked against any authority, so intact does not prove who signed. Revocation (CRL or OCSP) is never checked, because that means contacting the issuer over the internet, which this app does not do. The signing time is not independently verified.'
const toDer = (b: Uint8Array) => { const m = new TextDecoder('latin1').decode(b).match(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/); return (m ? Uint8Array.from(atob(m[1].replace(/\s+/g, '')), c => c.charCodeAt(0)) : b).slice().buffer as ArrayBuffer }
async function trustLine(sd: SignedData, cert: Certificate, roots: Uint8Array[]): Promise<string> {
  if (!roots.length) return 'Trust: not checked (no trusted root certificate supplied).'
  try {
    const trusted = roots.map(r => Certificate.fromBER(toDer(r))), others = ((sd.certificates ?? []) as Certificate[]).filter(c => !c.serialNumber.isEqual(cert.serialNumber))
    const v = await new CertificateChainValidationEngine({ trustedCerts: trusted, certs: [...others, cert], checkDate: new Date() }).verify()
    return v.result ? 'Trust: the certificate chains to a root you supplied (checked as of today).' : 'Trust: NOT established. The certificate does not chain to any root you supplied, or a certificate in the chain has expired.'
  } catch { return 'Trust: could not be checked (the root certificate file may be unreadable).' }
}
/** Cryptographically checks every PDF signature found in the bytes: the signed byte ranges must hash to the value in the signature, and the signature must verify with the embedded certificate. */
export async function verifySignatures(bytes: Uint8Array, roots: Uint8Array[] = []): Promise<SigResult[]> {
  if (!getCrypto()) { const c = globalThis.crypto; setEngine('local', new CryptoEngine({ name: 'local', crypto: c, subtle: c.subtle })) }
  const text = new TextDecoder('latin1').decode(bytes), out: SigResult[] = []
  for (const m of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const index = out.length + 1, [s0, a, b, c] = m.slice(1).map(Number)
    try {
      if (s0 !== 0 || a > b || b + c > bytes.length) throw new Error('range')
      const hex = text.slice(a, b).replace(/^\s*</, '').replace(/>\s*$/, '').replace(/\s+/g, ''), der = Uint8Array.from((hex.match(/../g) ?? []).map(h => parseInt(h, 16)))
      const asn = asn1js.fromBER(der.buffer as ArrayBuffer); if (asn.offset === -1) throw new Error('asn1')
      const sd = new SignedData({ schema: new ContentInfo({ schema: asn.result }).content }), data = new Uint8Array(a + c)
      data.set(bytes.subarray(0, a)); data.set(bytes.subarray(b, b + c), a)
      let ok = false, cert = sd.certificates?.[0] as import('pkijs').Certificate | undefined
      try { const v = await sd.verify({ signer: 0, data: data.buffer, checkChain: false, extendedMode: true }); ok = v.signatureVerified === true; cert = v.signerCertificate ?? cert } catch { ok = false }
      const who = cert ? `Signer: ${cn(cert.subject)}. Issued by: ${cn(cert.issuer)}. Certificate valid ${day(cert.notBefore.value)} to ${day(cert.notAfter.value)}. ` : ''
      if (!ok) out.push({ index, status: 'invalid', detail: `${who}The signature does not match the file: the content was changed after signing, or the signature is damaged.` })
      else out.push({ index, status: 'intact', detail: `${who}${cert ? await trustLine(sd, cert, roots) + ' ' : ''}${bytes.length - (b + c) <= 2 ? 'Covers the whole file.' : 'Content was added after this signature was made, so later changes are not covered by it.'}` })
    } catch { out.push({ index, status: 'unreadable', detail: 'This signature could not be read (damaged or an unsupported format).' }) }
  }
  return out
}
