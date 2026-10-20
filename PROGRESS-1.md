# دفتر البقالة (Daftar al-Baqala) — Where We Are So Far
*A plain-language summary for anyone, no tech background needed.*

## What we're building
An app for **grocery store owners** to keep track of who owes them money. Instead of a
paper notebook full of "Ahmed owes 500, paid 200," the shopkeeper records each customer
and their debts and payments on a phone, and the app shows every person's running balance.

Two promises the app keeps:
- **Works without internet** — the shop's data lives on the phone, so it keeps working
  even when the connection drops.
- **Safely backed up** — whenever there *is* internet, the data copies up to a secure
  server, so nothing is lost if the phone breaks or is replaced.

## The big news: the app is built and being used
When this note was first written, only the "engine room" existed and the actual phone app
was still to come. **That app now exists.** A shopkeeper can install it, use it all day
without internet, and it quietly backs everything up to the server. It's already being
used in real life to keep real books.

## What the app can do today

**Keep the accounts.** Add customers, record debts and payments, and see each person's
balance at a glance — who owes the shop, and who the shop owes. There's a search box, and
a running total for the whole book.

**Never lose the truth.** Entries can't be edited or erased. If there's a mistake, you add
a correcting entry — exactly like a real accountant's ledger. This keeps the money history
honest and trustworthy.

**Handle different currencies.** It tracks Yemeni riyals, Saudi riyals, dollars, and even
gold by the gram — and can show a rough riyal value alongside, using rates the owner sets.

**Make invoices and receipts.** The owner can keep a price list per shop, build an
itemised invoice by tapping items, and record it in one entry. The app can produce a
proper PDF statement (in Arabic), an Excel file, and can print a paper receipt on a small
Bluetooth printer.

**Tell the customer.** When a debt or payment is recorded, the app can send the customer a
tidy message over WhatsApp or a text message — signed by the shop, with the new balance
written out in words.

**Keep every shop separate.** The golden rule, protected above everything: no shopkeeper
can ever see another shopkeeper's data. Every single request is checked against "who are
you?" before any data is handed over.

## How the pieces fit together
Think of it like a restaurant:
- **The kitchen (the "server")** — the always-on computer in the cloud that stores
  everything and does the heavy lifting. Customers never see it.
- **The dining room (the "phone app")** — the screens the shopkeeper actually taps on.

Both halves are now built and working together. The phone works alone when it has to, and
the two "sync" — swap their latest information — the moment there's a connection.

## The journey so far
```
[✓] Server online, secure, always on
[✓] Database ready, every shop's data kept separate
[✓] Sign-up and login
[✓] Customers (add / list / edit / remove)
[✓] Debts & payments (honest, never-erased ledger)
[✓] Syncing phone <-> server, both directions
[✓] Paid-subscription check (cloud backup is the paid part)
[✓] The phone app people actually use — built and in real use
[✓] Multiple currencies, invoices, PDF & Excel, receipt printing, customer messages
[~] Getting ready for the Google Play store        <- here now
```

## A couple of bumps along the way (all fixed)
- The small server once ran out of memory and froze; we added a safety buffer (called
  swap) and it's been stable since.
- The website server (nginx) once stopped after an automatic update and stayed down for a
  few hours; we set it to restart itself automatically, so a repeat now heals in seconds.

## In one sentence
**The app is real, finished enough to use, and already in daily use** — it keeps a shop's
debts and payments straight, works with no internet, and safely backs everything up. The
last step is polishing it for release on the Google Play store.
