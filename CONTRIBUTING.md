# Contributing

Changes must preserve the plugin's evidence-only and fail-closed posture.

## Development contract

1. Use Node.js 20 or newer and install from the lockfile with `npm ci`.
2. Run `npm run check`, `npm run test:coverage`, and `npm run release:staged-check`.
3. Do not add wallet keys, seed phrases, payment payloads, recipient addresses, credentials, or
   production response bodies to code, fixtures, logs, issues, or pull requests.
4. Do not add retries around a transport that may settle x402 payments.
5. Treat HTTP 402 as a challenge, never as proof of settlement.
6. Keep quote-only as the default. Paid mode must retain an independently enforced host ceiling.
7. Update the pinned contract snapshot only through `npm run contracts:sync`, review the complete
   diff, and then rerun the live read-only contract gate.

## Pull requests

- Keep changes narrowly scoped and describe their threat-boundary impact.
- Add adversarial tests for every new parser, network path, payment boundary, or schema rule.
- Do not run paid live tests. The expected unpaid availability check is a 402 challenge.
- Breaking action, product, route, schema, or payment behavior requires a new release plan and
  explicit migration notes.

Publication, registry submission, production changes, and paid requests are maintainer-controlled
external actions and are not implied by merge approval.
