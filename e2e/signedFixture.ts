import forge from 'node-forge'
import { PDFDocument } from '@cantoo/pdf-lib'
const keys: forge.pki.rsa.KeyPair[] = []
const key = (i: number) => (keys[i] ??= forge.pki.rsa.generateKeyPair(2048))
const mkCert = (cn: string, pub: forge.pki.PublicKey, signKey: forge.pki.rsa.PrivateKey, issuerCn: string, ca: boolean) => {
  const c = forge.pki.createCertificate(); c.publicKey = pub; c.serialNumber = String(Math.floor(Math.random() * 1e6) + 1); c.validity.notBefore = new Date(Date.now() - 864e5); c.validity.notAfter = new Date(Date.now() + 864e5 * 365)
  c.setSubject([{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'Test Org' }]); c.setIssuer([{ name: 'commonName', value: issuerCn }, { name: 'organizationName', value: 'Test Org' }])
  if (ca) c.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true }]); c.sign(signKey, forge.md.sha256.create()); return c
}
/** Builds a PDF carrying a real detached PKCS#7 signature over its ByteRange. `chain` signs with a certificate issued by a throwaway root CA (the root is not embedded). */
export async function makeSignedPdf(opts: { tamper?: boolean; append?: boolean; chain?: boolean } = {}): Promise<Buffer> { return (await build(opts)).pdf }
export async function makeChainedSignedPdf() { const r = await build({ chain: true }); return { pdf: r.pdf, rootDer: r.rootDer, strangerDer: r.strangerDer } }
async function build(opts: { tamper?: boolean; append?: boolean; chain?: boolean }) {
  const d = await PDFDocument.create(); d.addPage([300, 400]); const base = Buffer.from(await d.save({ useObjectStreams: false })), N = 8192, pad = (n: number) => String(n).padStart(10, '0')
  const mk = (a: number, b: number, c: number, hex: string) => Buffer.from(base.toString('latin1') + `\n<< /Type /Sig /Filter /Adobe.PPKLite /Name (Test Signer) /ByteRange [0 ${pad(a)} ${pad(b)} ${pad(c)}] /Contents <${hex}> >>\n%%EOF\n`, 'latin1')
  const probe = mk(0, 0, 0, '0'.repeat(N)), a = probe.indexOf('<', probe.indexOf('/Contents')), b = a + N + 2, file = mk(a, b, probe.length - b, '0'.repeat(N))
  const root = mkCert('Test Root CA', key(1).publicKey, key(1).privateKey, 'Test Root CA', true), stranger = mkCert('Other Root', key(2).publicKey, key(2).privateKey, 'Other Root', true)
  const cert = opts.chain ? mkCert('Test Signer', key(0).publicKey, key(1).privateKey, 'Test Root CA', false) : mkCert('Test Signer', key(0).publicKey, key(0).privateKey, 'Test Signer', false)
  const signed = Buffer.concat([file.subarray(0, a), file.subarray(b)]), p7 = forge.pkcs7.createSignedData(); p7.content = forge.util.createBuffer(signed.toString('binary')); p7.addCertificate(cert)
  p7.addSigner({ key: key(0).privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256, authenticatedAttributes: [{ type: forge.pki.oids.contentType, value: forge.pki.oids.data }, { type: forge.pki.oids.messageDigest }, { type: forge.pki.oids.signingTime, value: new Date() as unknown as string }] }); p7.sign({ detached: true })
  const hex = forge.util.bytesToHex(forge.asn1.toDer(p7.toAsn1()).getBytes()).padEnd(N, '0'); let out = Buffer.from(file.toString('latin1').replace('0'.repeat(N), hex), 'latin1')
  if (opts.tamper) out = Buffer.from(out.toString('latin1').replace('/Name (Test Signer)', '/Name (Test Signex)'), 'latin1')
  const der = (c: forge.pki.Certificate) => Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes(), 'binary')
  return { pdf: opts.append ? Buffer.concat([out, Buffer.from('\n% added after signing\n')]) : out, rootDer: der(root), strangerDer: der(stranger) }
}
