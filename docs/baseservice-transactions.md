# BaseService transactions: why `this.db` is mutable, and how to use `withTransaction`

## The pattern

`BaseService` exposes `this.db` (the Drizzle client) and two methods that swap it:

```ts
setTransaction(tx)   // this.db = tx      — point this service at a transaction
unsetTransaction()   // this.db = pool    — restore the shared pool
```

Every service method reads `this.db`, so swapping it changes which connection all of that service's queries run on.

## Why it's built this way

Two constraints force it:

1. **Drizzle only hands you the tx handle inside the callback.** `db.transaction(async (tx) => …)` gives you `tx` only within that closure. But a service operation is usually a _flow_ of methods (`getOne`, `createQBProduct`, `logSync`, …), each of which reads `this.db`. Threading `tx` through every method signature — and through every nested service they call — would be invasive.
2. **Services are constructed synchronously.** `new InvoiceService(user)` runs in a normal constructor, and the SDK/DB handles are already in place. There's no async-factory seam to inject a tx at construction time.

So instead of passing `tx` everywhere, `setTransaction(tx)` temporarily repoints `this.db` at the tx; every method the service calls transparently joins the transaction; `unsetTransaction()` restores the pool afterward.

## Use `withTransaction`, not the raw pair

Pairing `setTransaction`/`unsetTransaction` by hand is error-prone (the unset can be skipped on a throw, or placed inside the callback so it runs before the commit). Use the helper on `BaseService`:

```ts
await this.withTransaction(async () => {
  await this.updateQBInvoice(...)
  await this.syncLogService.updateOrCreateQBSyncLog(...)
}, [this.syncLogService])
```

It runs `fn` inside `db.transaction(...)`, binds `this` **and every service in the array** to the tx, and restores all of them in a `finally` that **wraps** the transaction — so a throw or a failed commit can never leave a service pointing at a closed handle. (Introduced in OUT-4081.)

## The sharp edge — the part that bites

**Each `BaseService` instance has its own independent `this.db`.** A nested service is _not_ in the transaction just because the outer service started one. If a `fn` writes through `this.syncLogService` or a freshly-`new`'d `TokenService`, that instance must be in the `services` array — otherwise its writes run on the **pool, outside the transaction**, silently.

**TypeScript does not catch this.** The `services` array is completely decoupled from what `fn` actually calls, and a bound vs. unbound `this.db` have the identical type. So this compiles clean and is wrong at runtime:

```ts
await this.withTransaction(async () => {
  await this.syncLogService.updateQBSyncLog(...)  // compiles fine…
}, [])                                            // …but syncLogService was never bound → write escapes the tx
```

This is not hypothetical: `sync.service#checkAndSuspendAccount` did exactly this before OUT-4081 — the suspend-account and delete-logs writes lived inside `db.transaction(...)` but their services were never bound, so the two writes weren't atomic despite looking like they were.

**Rule when writing transactional code:** trace every DB call inside `fn` to the service instance it runs on, and confirm that instance is `this` or is in the `services` array.

## Why not make it type-safe?

The only way to get the compiler to enforce completeness is to stop mutating `this.db` and thread `tx` explicitly — e.g. `tx.insert(...)` directly, or DB methods that take a required `tx` parameter. That removes the footgun entirely (you physically cannot write without the handle in hand), but it's a large refactor touching every transactional method and the nested methods they call. It's deliberately deferred; `withTransaction` is the pragmatic middle ground that fixes the _pairing_ bug now while leaving the _completeness_ gap documented. See the OUT-4081 PR and `memory/project_unsetTransaction_bug.md`.
