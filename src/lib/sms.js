// SMS sending. SMS_PROVIDER = termii | africastalking | console
//  - termii:          TERMII_API_KEY, TERMII_SENDER_ID, TERMII_CHANNEL (dnd recommended for OTP; generic is blocked on DND numbers)
//  - africastalking:  AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optional)
//  - console:         prints messages to the server log (testing only)
const provider = () => (process.env.SMS_PROVIDER || 'console').toLowerCase();

async function sendTermii(phone, text) {
  const res = await fetch('https://api.ng.termii.com/api/sms/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TERMII_API_KEY, to: phone, from: process.env.TERMII_SENDER_ID || 'N-Alert',
      sms: text, type: 'plain', channel: process.env.TERMII_CHANNEL || 'dnd'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.code && data.code !== 'ok')) throw new Error('Termii: ' + (data.message || res.status));
  return data;
}

async function sendAT(phone, text) {
  const username = process.env.AT_USERNAME;
  const host = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const body = new URLSearchParams({ username, to: '+' + phone, message: text });
  if (process.env.AT_SENDER_ID) body.set('from', process.env.AT_SENDER_ID);
  const res = await fetch(host + '/version1/messaging', {
    method: 'POST', headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body
  });
  const data = await res.json().catch(() => ({}));
  const r = data?.SMSMessageData?.Recipients?.[0];
  if (!res.ok || !r || !/Success|Sent/i.test(r.status)) throw new Error("Africa's Talking: " + (r?.status || data?.SMSMessageData?.Message || res.status));
  return data;
}

// Returns true when handed to a real provider; never throws for non-critical messages when soft=true
async function sendSms(phone, text, { soft = false } = {}) {
  try {
    const p = provider();
    if (p === 'termii') await sendTermii(phone, text);
    else if (p === 'africastalking') await sendAT(phone, text);
    else { console.log(`[SMS to ${phone}] ${text}`); return false; }
    return true;
  } catch (e) {
    console.error('SMS failed:', e.message);
    if (!soft) throw Object.assign(new Error("We couldn't send the SMS. Try again in a minute."), { status: 502 });
    return false;
  }
}

module.exports = { sendSms, provider };
