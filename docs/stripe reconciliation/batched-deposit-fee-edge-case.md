# Batched-deposit fee edge case (OUT-4009)

## The setup

Two settings control how Stripe fees land in QuickBooks:

- **`absorbedFeeFlag`** — book the Stripe fee as an expense.
- **`bankDepositFeeFlag`** (the "batched-deposit" flag) — decides **who** books that fee:
  - **OFF** → fee booked immediately at `payment.succeeded` as an individual QBO **Purchase**.
  - **ON** → fee is deferred; the payment parks in **Undeposited Funds (UF)**, and one QBO **Bank Deposit** per Stripe payout books the fee later.

> **UF (Undeposited Funds)** is a QuickBooks holding account — a "waiting room". Payments sit there until a Bank Deposit sweeps them into the real bank account. That deposit is what matches the bank feed 1:1.

## The bug

The flag is read **live** at two different moments — once at `payment.succeeded`, once at `payout.reconciliation`. If the user toggles it in between, the two disagree:

- **OFF → ON:** fee booked at payment time **and** again in the deposit → **fee booked twice.**
- **ON → OFF:** payment parked in UF, but the payout handler returns early → **fee never booked + payment stranded in UF.**

```mermaid
sequenceDiagram
    participant U as User (settings)
    participant P as payment.succeeded
    participant PO as payout.reconciliation

    Note over P,PO: OFF→ON  ⇒  double fee
    P->>P: flag OFF → book individual fee Purchase
    U->>U: toggle ON
    PO->>PO: flag ON → deposit ALSO books the fee
    Note over PO: ❌ same fee booked twice

    Note over P,PO: ON→OFF  ⇒  missed fee
    P->>P: flag ON → defer fee, payment → UF
    U->>U: toggle OFF
    PO->>PO: flag OFF → early return, no deposit
    Note over PO: ❌ fee never booked + payment stranded in UF
```

## The fix

**Freeze the decision per invoice.** When the payment routing is decided, store `isBatchedDeposit` on the invoice-sync row. Both handlers read that frozen value instead of the live flag.

At payout time the decision is **all-or-nothing** by frozen intent:

```mermaid
flowchart TD
    A["payout.reconciliation"] --> B["Read frozen isBatchedDeposit<br/>for every line item"]
    B --> C{All batched?}
    C -->|Yes| D["✅ Create one deposit<br/>fees folded in → 1:1 bank match"]
    C -->|No| E{All non-batched?}
    E -->|Yes| F["✅ No deposit<br/>fees already booked at payment"]
    E -->|"No — mixed"| G["⚠️ Skip deposit<br/>log FAILED + notify → manual reconciliation"]
```

## Why "mixed" can't be auto-handled

A single Stripe payout can straddle a toggle, mixing batched and non-batched invoices. There's no way to render that as one balanced deposit without either double-booking a fee, breaking the 1:1 bank match, or destructively deleting already-booked Purchases (and there is **no `deleteDeposit`** to undo mistakes). So a mixed payout is quarantined for manual reconciliation instead of guessed.

A settings dialog warns users that toggling mid-cycle can leave one payout needing manual reconciliation — but that's UX only; correctness comes from the frozen intent above.
