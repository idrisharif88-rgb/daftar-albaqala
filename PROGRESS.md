# دفتر البقالة (Daftar al-Baqala) — Where We Are So Far
*A plain-language summary for anyone, no tech background needed.*

## What we're building
An app for **grocery store owners** to track who owes them money. Instead of a paper
notebook full of "Ahmed owes 500, paid 200," the shopkeeper records customers and their
debts/payments on their phone, and the app shows each person's running balance.

Two important promises:
- **Works without internet** — the shop's data lives on the phone, so it works even when
  the connection drops.
- **Safely backed up** — when there *is* internet, the data copies up to a secure server,
  so nothing is lost if the phone breaks.

## How to picture the project: two halves
Think of it like a restaurant:
- **The kitchen (the "server")** — the part customers never see. It stores all the data and
  does the real work. *This is what we've been building.*
- **The dining room (the "phone app")** — the screens shopkeepers will actually tap on.
  *This comes later.*

We're building the kitchen first, because the dining room is useless without it.

## What's done so far

**1. The server is set up and online.**
We rented a computer in the cloud (always on, 24/7) and got it running on the internet at a
secure web address. It's the engine room of the whole project.

**2. The "filing cabinet" is ready.**
We set up the database — the organized storage for three kinds of records: shop owners,
their customers, and the debts/payments. It's designed so every shop's data stays completely
separate from every other shop's.

**3. Sign-up and login work.**
A shop owner can create an account with a password and log in securely. Passwords are stored
scrambled, so even we can't read them.

**4. The server can now manage customers.**
It can add a customer, show the list, edit one, and remove one — with built-in rules: no two
customers with the same phone number, and "removing" actually just hides them (so the deletion
can sync to the phone later without losing history).

**5. The server can now track debts and payments.**
It can record a debt or a payment for a customer and list them all. Importantly, **records can
never be edited or erased** — if there's a mistake, you add a correcting entry instead. This
keeps the money history honest and trustworthy, like a real accountant's ledger.

## One bump along the way (now fixed)
The server briefly froze once — it ran out of memory because several programs were sharing a
small machine. We added a **"safety buffer"** (called swap) so it won't freeze like that again.
The server is now stable.

## The golden rule we protect above everything
**No shopkeeper can ever see another shopkeeper's data.** Every single request to the server is
checked against "who are you?" before any data is handed over. This is the most important safety
rule in the whole project, and it's built into every feature.

## Where we are on the journey
```
[✓] Server online
[✓] Database ready
[✓] Login & accounts
[✓] Customers (add / list / edit / remove)
[✓] Debts & payments
[ ] Syncing phone <-> server + paid subscription   <- next
[ ] The phone app people actually use               <- after that
```

## In one sentence
**The "brain" of the app is now built and working** — it can sign people in and keep track of
their customers and debts on a secure, always-on server. What's left is connecting it to phones
and building the screens people will tap on.
