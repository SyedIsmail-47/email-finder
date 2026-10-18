# Email Finder

A product of **Rodexco** — guess a work email from a name and domain, then
prove it with a real mailbox check that never sends mail.

## What it does

For each person you provide, builds the common professional address patterns
and verifies them through the same SMTP engine as Bulk Email Verifier. Stops
at the first `valid` mailbox. If nothing is valid, keeps the first `risky`
result (catch-all domains). Otherwise returns `not_found` or `unknown`.

## Patterns tried (in order)

1. `first.last@domain`
2. `flast@domain` (first initial + last)
3. `first@domain`
4. `firstinitiallast@domain` (same mailbox as `flast` for ASCII names)
5. `last.first@domain`
6. `lastf@domain` (last + first initial)

Duplicate addresses are checked once.

## Input

| Field | Description | Default |
|---|---|---|
| `people` | List of `{ firstName, lastName, domain }` | Ada Lovelace / mailbox-check.invalid |
| `smtpTimeoutMs` | Timeout per SMTP attempt | 10000 |
| `maxConcurrentPerDomain` | Max simultaneous checks against one mail domain | 2 (max 3) |

## Output

One record per person:

```json
{
  "firstName": "Ada",
  "lastName": "Lovelace",
  "domain": "mailbox-check.invalid",
  "foundEmail": null,
  "emailStatus": "not_found",
  "patternUsed": ""
}
```

Possible `emailStatus` values: `valid`, `risky`, `not_found`, `unknown`.

## Notes

- This Actor never sends actual email — verification stops before `DATA`.
- The default sample uses the reserved `.invalid` domain so a Console QA run
  finishes without contacting a real mail server.
- Catch-all domains are reported as `risky`, not `valid`.

## Support

Built and maintained by Rodexco. For issues or feature requests, reach out
via the Actor's Issues tab on Apify Store.
