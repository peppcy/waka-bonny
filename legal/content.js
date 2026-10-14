// The single source of the legal text. The server serves it to the app, and
// build-docx.js turns the same text into the Word files. Edit here, nowhere else.
const COMPANY = 'Cylan Metro Limited';
const RC = 'RC 9398200';
const ADDRESS = '41 Mission Road, Bonny Island, Rivers State, Nigeria';
const EMAIL = 'support@wakabonny.ng';
const APP = 'Waka Bonny';
const UPDATED = '13 October 2026';

const terms = {
  id: 'terms',
  title: 'Terms of Use',
  intro: `These terms are an agreement between you and ${COMPANY} (${RC}), of ${ADDRESS}. They cover your use of the ${APP} app and everything you book through it. By creating an account or using the app, you accept them. If you do not accept them, please do not use the app.`,
  sections: [
    ['What Waka Bonny is', [
      `${APP} connects people on Bonny Island with drivers and riders who carry passengers, deliver parcels, run errands, and carry people and goods between Bonny and Port Harcourt. It also lets depots register packages that have arrived for people on the island.`,
      `${COMPANY} runs the app. We are not a transport company. The drivers, riders and vehicle owners on the app are independent: they own or operate their own vehicles, hold their own permits from the riders' association or union, and are responsible for their own licensing, roadworthiness and insurance. When you book, your contract for the journey or delivery is with that driver.`,
      'We verify drivers before they can work on the app, record every trip, and give you a way to raise problems. We do not employ drivers and we do not control how they drive.'
    ]],
    ['Who can use the app', [
      'You must be 18 or older and have a Nigerian phone number that can receive SMS.',
      'You must give your real name and your own phone number. Accounts in false names may be closed.'
    ]],
    ['Your account and PIN', [
      'You sign up with your phone number, confirm it with a code we send by SMS, and choose a PIN of 4 to 6 digits.',
      'Keep your PIN to yourself. Anything done with your PIN is treated as done by you. If you think someone else knows it, change it under Account, or tell us at ' + EMAIL + '.',
      'You may add an emergency contact. We show that number on the SOS screen and use it as the suggested next of kin when you book a seat to Port Harcourt.'
    ]],
    ['Rides', [
      'Fares are fixed for each pair of areas and for each vehicle type, and are shown in full before you book. A night surcharge may apply at the hours shown in the app.',
      'Once a driver accepts, you can see their name, their vehicle, its plate number and their permit number. Check the plate before you get in.',
      'During a trip you can share a live tracking link, and use the SOS button to alert the safety desk.',
      'You pay the fare shown. Do not pay more than the fare, and tell us if you are asked to.'
    ]],
    ['Parcels and errands', [
      'For a parcel, you give the recipient\'s name and phone number. We send them a 4-digit code by SMS. The rider can only complete the delivery by entering that code, so do not share it until the parcel is in the recipient\'s hands.',
      'For an errand, the rider buys or collects what you asked for and you repay the cost of the items in cash on delivery, on top of the errand fare.',
      'You must not send cash, jewellery, bank cards, documents of title, live animals, drugs, weapons, explosives, fuel, corrosive or any other dangerous or unlawful item. We may refuse or stop a delivery and report it where the law requires.',
      'Pack your parcel properly. Riders carry items on motorcycles, tricycles and cars, which is not suitable for fragile or very valuable goods.'
    ]],
    ['Seats between Bonny and Port Harcourt', [
      'Seats are sold by independent bus and Sienna operators through the app. The departure time shown is the time the operator plans to leave; road, weather and security conditions can change it.',
      'Every booking carries your name, phone number and a next of kin with their phone number. This goes on the operator\'s passenger manifest, which exists for your safety and may be shown to the union, the police or emergency services.',
      'Be at the park in good time. If the vehicle departs without you, the seat is treated as a no-show.'
    ]],
    ['Packages at a depot', [
      'When goods arrive for you at a depot that uses the app, the depot registers them and we send you an SMS with a pickup code and a link.',
      'You can collect the package at the depot by giving the code and paying the logistics charge, or ask for it to be delivered to you for the delivery fee shown.',
      'If you have lost the SMS, depot staff may hand the package over after checking a photo identity document that matches the name on it. They record what they checked.',
      'The logistics charge is set by the depot or the sender, not by us.'
    ]],
    ['Paying', [
      'You can pay cash, pay by transfer to the driver\'s own bank account, or pay in the app by card, bank, USSD or transfer through Paystack.',
      'When you pay in the app for a fare, Paystack divides the payment as it is made: our commission, if any, comes to us and the rest goes straight to the driver\'s bank account. We never see or store your card details.',
      'Seats to Port Harcourt paid in the app are held for 15 minutes while you pay. If payment is not completed the seats are released.'
    ]],
    ['Cancelling and refunds', [
      `Our Refund and Cancellation Policy forms part of these terms. You can read it in the app or ask for a copy at ${EMAIL}.`
    ]],
    ['How you must behave', [
      'Treat drivers, riders, depot staff and other passengers with respect. Abuse, threats, harassment and discrimination are not allowed.',
      'Do not use the app to commit a crime, to carry unlawful goods, to impersonate another person, or to interfere with how the app works.',
      'Do not create accounts for other people or use a number that is not yours.',
      'We can suspend or close an account that breaks these rules. Where that happens we tell you the reason.'
    ]],
    ['Drivers, riders and vehicle owners', [
      'You must give true details at sign-up, including your plate number and your association or union permit number, and say whether you own the vehicle or drive it for someone else.',
      'You must send photographs of your identity document, vehicle papers, permit and vehicle when the app asks for them. We may refuse or withdraw approval if they are missing, unclear or false.',
      'You are responsible for your own vehicle licence, roadworthiness, insurance and any permit the local authority or your union requires. We do not provide insurance.',
      'Keep the app open during a job so the customer can follow the trip. Collect only the fare shown, plus the cost of items on an errand.',
      'Complaints are recorded. Three upheld complaints suspend an account. Serious misconduct can suspend it at once.',
      'During our launch campaign there is no weekly fee. If we introduce a weekly subscription or a commission later, we will tell you in the app before it starts.',
      'If you add a bank account, we verify it with your bank through Paystack and use it to pay you fares that customers paid in the app. Keep it up to date; we are not responsible for money sent to an account number you entered wrongly.',
      'The QR badge we issue is for your vehicle only. Do not lend it to another vehicle or driver.'
    ]],
    ['Safety', [
      'The SOS button alerts our safety desk and shows your trip details. It is not an emergency service. In an emergency, call the police, a hospital or the emergency services directly.',
      'Live tracking depends on mobile networks and on the phone being switched on with location allowed. It can be delayed or unavailable.'
    ]],
    ['What we are responsible for', [
      'We provide the app with reasonable care, but we do not promise it will always be available, free of faults, or that maps, estimated times and locations will always be accurate.',
      'We are not responsible for the acts or omissions of drivers, riders, operators or depots, for the condition of their vehicles, or for loss or damage to goods they carry, except where the law makes us responsible.',
      'Nothing in these terms limits any liability that cannot be limited under Nigerian law, including liability for death or personal injury caused by our negligence, or for fraud.'
    ]],
    ['Suspending or closing an account', [
      'You can ask us to close your account at any time by writing to ' + EMAIL + '.',
      'We may suspend or close an account that breaks these terms, is used for fraud, or puts other people at risk. When an account is closed we remove or anonymise personal details, as set out in our Privacy Policy, and keep the records the law requires us to keep.'
    ]],
    ['Changes', [
      'We may change these terms as the service grows. We will post the new version in the app and change the date at the top. If you keep using the app after a change, you accept the new version.'
    ]],
    ['Law and disputes', [
      'These terms are governed by the laws of the Federal Republic of Nigeria.',
      'If something goes wrong, please contact us first at ' + EMAIL + ' so we can try to put it right. If we cannot agree, the courts of Rivers State, Nigeria, will deal with the dispute.'
    ]],
    ['Contact', [
      `${COMPANY} (${RC}), ${ADDRESS}. Email ${EMAIL}.`
    ]]
  ]
};

const privacy = {
  id: 'privacy',
  title: 'Privacy Policy',
  intro: `${COMPANY} (${RC}), of ${ADDRESS}, is the data controller for personal information collected through the ${APP} app. This policy explains what we collect, why, who we share it with, how long we keep it, and the rights you have under the Nigeria Data Protection Act 2023.`,
  sections: [
    ['What we collect', [
      'Account details: your name, phone number, the type of account, and an emergency contact if you add one. Your PIN is never stored as you typed it, only as an encrypted value we cannot reverse.',
      'Trip and delivery records: the areas you travel between, any landmark you type, the vehicle type, the fare, the time, ratings and any complaint.',
      'Location: your device location while you are booking, so the map can show where you are and place your pickup point; and during a trip, so you, the driver and anyone you share the trip with can follow it on the map. For deliveries we use the rider\'s location.',
      'Payments: the amount, the method, and the Paystack reference. Card and bank details are handled by Paystack and never reach us. For drivers, the bank account you add, which we check with your bank through Paystack.',
      'Driver documents: photographs of your identity document, vehicle papers, permit and vehicle, and whether we approved them.',
      'Port Harcourt bookings: the traveller\'s name and phone number and a next of kin with their phone number, for the operator\'s manifest.',
      'Depot packages: the recipient\'s name and phone number, a description of the item, the charge, and the delivery address if delivery is requested.',
      'Messages: the SMS we send you, and messages we send to groups of users.',
      'Technical information: the device and browser you use, your IP address, and server logs, which we use to keep the service working and secure.'
    ]],
    ['Why we use it, and our lawful basis', [
      'To provide what you asked for: create your account, dispatch a driver, take payment, deliver a parcel. This is necessary to perform our contract with you.',
      'For safety: verifying drivers, recording trips, the SOS button, manifests and complaint handling. This is in our legitimate interest and in the interest of everyone using the service, and in some cases a legal obligation.',
      'To confirm your phone number by SMS, which protects you and other users from false accounts. This is necessary to perform our contract and in our legitimate interest.',
      'To use your location. The app asks your permission first, and you can refuse or withdraw it in your phone settings. Without it, the map cannot show where you are, but you can still book by choosing an area.',
      'To keep accounting and tax records, and to answer the police, the courts or a regulator where the law requires it. This is a legal obligation.',
      'To tell you about the service by SMS, such as a change to fares or to driver fees. This is in our legitimate interest in running the service. We do not sell your details and we do not send advertising on behalf of other companies.'
    ]],
    ['Who sees your information', [
      'The driver or rider carrying out your job sees your first name, your phone number, your pickup and drop-off, and any landmark you wrote. Drivers do not see your full trip history.',
      'For a parcel, the recipient receives an SMS with the item description, the amount due and a delivery code.',
      'For a Port Harcourt seat, the operator sees the manifest, including the next of kin you gave.',
      'For a depot package, the depot\'s staff see your name, phone number, item and charge.',
      'Anyone you send a trip-tracking link to can see that trip\'s route, the driver\'s name and the vehicle, until the trip ends.',
      'Our service providers: Paystack for payments, our SMS provider for text messages, MapTiler and OpenStreetMap for maps, and Railway for hosting the app and its database. They act on our instructions.',
      'The riders\' association or union desk, where a complaint or safety incident concerns one of their members.',
      'The police, emergency services, a court or a regulator, where the law requires it or where someone\'s safety is at risk.'
    ]],
    ['How long we keep it', [
      'Location trails and the map coordinates of pickups and drop-offs: 12 months, then deleted automatically.',
      'Trip, parcel and package records: 12 months in full. After that we keep them only in a form that no longer identifies you, for counting trips and planning the service.',
      'Payment records: 6 years, because company and tax law requires it.',
      'Driver documents: while your account is open. They are deleted when you replace them or when the account is deleted.',
      'Safety reports, SOS alerts and complaints: 3 years.',
      'SMS codes used to sign in: a few days, then deleted.',
      'Account details: while your account is open. When an account is deleted, we remove the name, phone number, PIN, emergency contact, documents and saved locations, and keep the remaining records in anonymous form.'
    ]],
    ['Your rights', [
      'Under the Nigeria Data Protection Act 2023 you can ask us to: give you a copy of your personal information; correct it if it is wrong; delete it; stop or limit how we use it; give it to you in a portable form; or object to use based on our legitimate interests.',
      'Where we rely on your consent, such as location, you can withdraw it at any time. That does not affect what we did before you withdrew it.',
      `To exercise any of these, write to ${EMAIL} from the phone number or email on your account. We answer within 30 days.`,
      'If you are not satisfied, you can complain to the Nigeria Data Protection Commission (NDPC).'
    ]],
    ['Keeping it safe', [
      'The app is served only over an encrypted connection. PINs are stored as irreversible encrypted values. Driver documents are not public: they are shown through a link that expires after 20 minutes.',
      'Access to the administration screens is limited to named people and every action on an account is logged with who did it and why.',
      'No system is perfectly secure. If a breach affects your rights we will tell you and the NDPC as the law requires.'
    ]],
    ['Children', [
      'The app is for people aged 18 and over. We do not knowingly collect information about children. If you believe a child has an account, tell us at ' + EMAIL + ' and we will remove it.'
    ]],
    ['Changes', [
      'We will post any new version of this policy in the app and change the date at the top.'
    ]],
    ['Contact', [
      `For any question about this policy or about your information, write to ${EMAIL}, or to ${COMPANY}, ${ADDRESS}.`
    ]]
  ]
};

const refunds = {
  id: 'refunds',
  title: 'Refund and Cancellation Policy',
  intro: `This policy explains when you can cancel, and when and how money is refunded. It applies to everything booked through the ${APP} app and forms part of our Terms of Use.`,
  sections: [
    ['Rides, parcels and errands', [
      'You can cancel free of charge at any time before a driver accepts your request.',
      'After a driver accepts and is on the way, please cancel only if you must. Repeated late cancellations may lead us to limit an account.',
      'Once a trip or delivery has started, the fare is due and is not refunded, unless the service was not provided: for example, the driver never arrived, the parcel was not delivered, or the errand items were not bought.',
      'If you paid in the app and the service was not provided, we refund the full amount you paid.',
      'For an errand, you repay the rider the cost of the items on delivery. If the rider could not buy the items, nothing is due for them.'
    ]],
    ['Seats between Bonny and Port Harcourt', [
      'A seat paid in the app is refunded in full if you cancel before the vehicle departs.',
      'If you do not arrive and the vehicle departs without you, the seat is a no-show and is not refunded.',
      'If the operator cancels the departure, or the vehicle does not run, you get a full refund.',
      'Seats held while you pay are released automatically after 15 minutes if payment is not completed. Nothing is charged.'
    ]],
    ['Packages at a depot', [
      'The logistics charge is paid when you collect the package or when it is delivered to you. Nothing is taken in advance.',
      'If a rider cannot deliver your package, it goes back to the depot and no delivery fee is due. You can collect it there or ask for delivery again.'
    ]],
    ['Driver weekly subscriptions', [
      'A weekly subscription covers a full week from the day it is paid and is not refunded part-way through a week.',
      'If you turn off automatic weekly payment, it stops at the end of the week you have already paid for.',
      'If we suspend your account for breaking our terms, the subscription is not refunded.'
    ]],
    ['How to ask for a refund', [
      `Write to ${EMAIL} within 14 days, with the payment reference shown in the app (it begins with WB) or your booking reference, and what went wrong.`,
      'We reply within 3 business days.',
      'Approved refunds go back to the card or account you paid from. Paystack normally returns the money within 7 to 10 business days, depending on your bank.'
    ]],
    ['Cash and transfers paid directly to a driver', [
      'Money you hand to a driver in cash, or transfer to their own bank account, does not pass through us, so we cannot reverse it.',
      `Tell us at ${EMAIL} and we will take it up with the driver and the riders' association. We can suspend a driver who overcharges or refuses to return money that is not theirs.`
    ]],
    ['Disputed card payments', [
      'If you believe a payment in the app was not made by you, contact us first. We can usually resolve it faster than your bank, and we will give you the trip record and payment reference.'
    ]],
    ['Contact', [
      `${COMPANY} (${RC}), ${ADDRESS}. Email ${EMAIL}.`
    ]]
  ]
};

module.exports = { COMPANY, RC, ADDRESS, EMAIL, APP, UPDATED, docs: [terms, privacy, refunds] };
