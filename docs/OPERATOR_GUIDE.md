# Operator guide — Asiaway QR ordering

For the people working the floor. Phase 1: the QR system takes the order, you
confirm it, and you key it into the existing POS. **Payment always happens at the
POS, never in this app.**

---

## Daily start

1. Open the tablet browser at `/waiter` and sign in.
   Signing in is also what allows the alert sound to play — browsers block audio
   until someone taps something, so **you must sign in on the device that should
   chime.**
2. Check the connection pill, top right:
   - **Live** — alerts arrive instantly.
   - **Delayed** — the live connection dropped; the app is checking every 10
     seconds instead. Nothing is lost, alerts just arrive a little later.
   - **Connecting…** — reconnecting; wait a moment.
3. Check the **Sold out** screen and restore anything the kitchen has again.

## A new order arrives

You get a banner, a chime and a vibration. The banner **stays until you open the
order** — it never disappears on its own, and it repeats the chime every 30
seconds so a busy room cannot swallow it.

1. Tap **Open** on the banner (or go to **New orders**).
2. Read the **special request** box first. It is the yellow block at the top —
   free text from the guest, and the easiest thing to get wrong.
3. Go to the table and check the order with the guest.
4. Adjust if needed:
   - **−** / **+** change a quantity; dropping to zero removes the line.
   - **Add an item** searches by dish number or name.
   - **Reason for the change** is optional but recommended — it goes into the
     order history, which is what protects you in a dispute.
5. Tap **Confirm order**. It leaves the queue.
6. **Key the confirmed order into the POS.** The confirmation screen is laid out
   for exactly this; the order number is at the top for cross-reference.

### What the guest sees
Their own order list shows the final version and is marked "adjusted by our
team" when you changed something. They never see internal statuses and they
cannot cancel an order themselves.

### If the order changed on another device
You get "Another device changed this order" and the latest version reloads.
Check it and redo your change — nothing was lost.

## More orders at the same table

Guests scan the same QR and order again. Each one gets **its own order number**
and appears as a separate order. An earlier order is never altered by a later
one.

## Marking a dish sold out

**Sold out** in the header → search → **Mark sold out**.

It applies instantly for every guest: the dish stays visible on the menu with a
SOLD OUT badge and cannot be added. **Restore** puts it back. Nothing needs to be
redeployed, and re-importing the menu never silently puts a sold-out dish back on
sale.

## The guest asks for the bill

1. A **Bill requested** alert appears (it is styled red, distinct from an order).
2. Go to the table and confirm the table number with the guest.
3. Take payment at the POS — cash or card, exactly as you do today.
4. In the app, open the table and tap **Payment taken — close session**, then
   confirm.

The session stays open until you close it. Asking for the bill does **not** close
anything, and the guest can still order a coffee afterwards.

### If it will not close
"Some orders are still waiting" means an order has not been confirmed. Confirm
it first. If you must close anyway, the app asks for a reason and records it.

### After closing
The table returns to **Free**. The next guests scanning that QR get a brand-new
session — they can never see the previous party's orders.

## Table tiles

| Colour | Meaning |
|---|---|
| White — **Free** | No open session. |
| Green — **Seated** | Guests at the table, nothing waiting on you. |
| Yellow — **Order waiting** | At least one order needs confirming. |
| Red — **Bill requested** | The guest asked for the bill. |

Each tile shows how long the table has been seated and its running total.

## Things worth knowing

- **A party left without asking for the bill?** Open the table and close the
  session, so the next guests start clean. Sessions idle for 4 hours close
  themselves automatically.
- **Guest seated before they scan?** Nothing to do — their scan joins the table.
- **Tablet asleep?** The app asks the device to stay awake, but check the
  device's own sleep setting too.
- **Network dropped?** Keep working. The app recovers pending alerts when it
  reconnects; the server, not the tablet, is the record of what is waiting.
- **Nothing is ever deleted.** Every change keeps the guest's original order and
  records who changed what, when, and from what to what.

## Combined tables

When tables are joined, **the lowest-numbered table anchors the session** and
scanning any joined table's QR reaches that same session — a guest at the far end
never has to hunt for the right code. Joining and un-joining tables is a data
setting; ask your administrator until the screen for it is added.

## What this app does NOT do in Phase 1

Take payment · talk to the POS · print to the kitchen or bar · track guests ·
collect any name, phone number or email.
