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

## How a bill is read (free by default)

1. **The text is taken off the bill on our own server**: PDFs that contain text are read exactly (`pdftotext`);
   photos and scanned PDFs go through Tesseract (OCR) after a little cleaning (greyscale, contrast, enlarged).
   This costs nothing and takes about a second.
2. **Only that text** goes to a free text model on OpenRouter (default `nvidia/nemotron-3-super-120b-a12b:free`, with
   two fallbacks), which returns the supplier, bill number, date, lines and total. A few hundred tokens, not the
   thousand-plus a picture costs. Only the suppliers/items that share a word with the bill's text are mentioned to
   the AI; matching to your real records is done by the app (GSTIN, Product ID, name, and near-identical names).
3. **If that doesn't give a bill that adds up** (the app checks qty × rate + GST against the printed total), or the
   photo is too hard to read (OCR confidence under 55%), the **picture** goes to a free vision model
   (default `google/gemma-4-31b-it:free`, with two fallbacks). The summary says which way was used.
4. If neither gives a bill that adds up, there's no Enter button: reply with a correction or send a clearer photo.

Settings → Telegram lets you change the models (up to three ids each, tried in order; saving checks they exist on
OpenRouter) and choose "Always send the picture" instead.

**Tip:** send the bill as a **File** (📎 → File), not a Photo. Telegram shrinks ordinary photos to 1280 pixels,
which makes small print harder to read; a File arrives at full size.

**Limits of free models:** OpenRouter allows 20 requests a minute and **50 a day** on free models, or 1,000 a day
once you've ever bought $10 of credit. A bill uses one request, two when the picture backup is needed. Free models
also come and go, so if one is retired just change the id on the settings screen.

## Costs and privacy

With the free models there is no per-bill cost. Free models are run by outside providers who may keep and learn
from what they receive: the OCR text (supplier, items, amounts) in the normal case, and the picture itself when the
backup read is needed. Don't use them for anything confidential; there is no way yet to keep the picture on the
server while still using the backup read. The photo is also kept in the app's database with
the bill. You can switch to a paid model on the settings screen at any time.
