# Telegram bill bot

Send a photo (or PDF) of a bill to the bot; it reads it, shows what it found, and enters it into the linked
company only when you tap **Enter**.

## Setting it up (Owner, once)

1. In Telegram open **@BotFather** → `/newbot` → choose a name → copy the token.
2. At openrouter.ai → Keys, make a key just for this with a monthly credit limit → copy it.
3. In the app (live site, https): Settings → **Telegram** → paste both → Save. The app checks them and tells
   Telegram where to send messages. They're stored encrypted and never shown again.
4. Turn **Telegram bills** on for the company (e.g. DNHCARE).
5. Tap **Link my Telegram**, open the link on your phone and tap **Start**. The bot says "Linked ✅".

Only the Owner can be linked. Anyone else who messages the bot is told it's private.

## Sending a bill

- One photo = one bill. Several photos sent together (an album) = the pages of one bill. PDFs work too.
- A caption is passed to the reader as a note ("this is for the clinic", "paid by GPay").
- The bot replies with the supplier (new or existing), bill number, date, each item (new or existing, qty, rate,
  GST %), and the total — with ✓ when the app's total matches the printed one.
- ⚠️ lines are things to look at (e.g. a bill number already entered for that supplier, no date printed).
- ❌ lines mean it can't be entered as it stands; there's no Enter button.

Buttons:
- **Enter – not paid yet**: a purchase bill, unpaid (pay it later from the bank statement or the app).
- **Enter – paid from Cash in hand** (and each bank account): entered and paid at once from that account.
- **Discard**: nothing is entered.

Expenses (electricity, rent, phone, fuel…) are entered as an expense in the matching category, paid from the
account you tap.

To fix a reading, **reply to the summary** with the correction in plain words — "total is 742", "supplier is
MedPlus Pharma", "item 2 is 12% GST" — and it reads the bill again with your note.

`/company` in the bot chooses which company bills go to (among companies with Telegram bills on).

## Where it shows up

- The bill page says "Created … through Telegram" with **View photo**.
- Bill lists tag it "API"; Settings → Telegram lists the latest bills sent and what became of them.
- The Activity log says "Via Telegram (sent by …)".

## Costs and privacy

Each reading is one OpenRouter call (roughly ₹1–3 per bill with the default model). The photo is sent to
OpenRouter and the model provider to be read, and is kept in the app's database with the bill.
