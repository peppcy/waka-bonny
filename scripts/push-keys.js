// node scripts-push-keys.js — prints a new pair of push keys to paste into Railway
const { generateVAPIDKeys } = require('web-push');
const k = generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + k.publicKey);
console.log('VAPID_PRIVATE_KEY=' + k.privateKey);
console.log('VAPID_SUBJECT=mailto:support@wakabonny.ng');
console.log('\nPaste these three into Railway -> waka-bonny -> Variables (Raw Editor).');
console.log('Keep the private key secret. Changing it later signs every phone out of notifications.');
