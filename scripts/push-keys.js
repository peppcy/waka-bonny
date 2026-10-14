// npm run push:keys — prints a new pair of push keys to paste into Railway.
// Uses only Node's own crypto, so it runs in a fresh copy of the project with nothing installed.
// A VAPID key pair is an ordinary P-256 key pair: the public key is the uncompressed
// 65-byte point and the private key the 32-byte scalar, both in base64url.
const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
const jwk = privateKey.export({ format: 'jwk' });
const priv = Buffer.from(jwk.d, 'base64url');

if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) {
  console.error('Could not generate the keys on this machine. Run "npm install" and try again.');
  process.exit(1);
}

console.log('VAPID_PUBLIC_KEY=' + pub.toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + priv.toString('base64url'));
console.log('VAPID_SUBJECT=mailto:support@wakabonny.ng');
console.log('\nPaste these three into Railway -> waka-bonny -> Variables (Raw Editor), then redeploy.');
console.log('Keep the private key secret. Changing it later switches alerts off on every phone,');
console.log('and each person has to turn them on again.');
