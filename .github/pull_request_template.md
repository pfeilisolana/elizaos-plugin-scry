## Change

Describe the behavior and why it is needed.

## Safety impact

- [ ] Quote-only remains the default.
- [ ] A 402 challenge is never treated as settlement.
- [ ] No retry can duplicate a payment-capable transport call.
- [ ] No secret, payment payload, recipient field, or private response data is included.
- [ ] New parser/network/payment behavior has adversarial tests.

## Verification

- [ ] `npm run check`
- [ ] `npm run test:coverage`
- [ ] `npm run release:staged-check`
- [ ] Contract snapshot changes, if any, were reviewed separately.

Publishing, registry submission, production changes, and paid requests require separate maintainer
authorization and are not included in this pull request.
