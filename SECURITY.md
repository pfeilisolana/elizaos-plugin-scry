# Security Policy

## Supported version

Version `0.1.x` is the current pre-publication line.

## Threat boundaries

- Never put wallet keys, seed phrases, payment headers, or credentials in plugin configuration,
  prompts, logs, issues, or test fixtures.
- Paid mode is permitted only with the included Base V2 transport or a host-owned x402 transport
  that independently enforces the same USD ceiling declared to `createScryPlugin`.
- The included transport accepts only canonical Scry wallet GET routes, exact Base USDC on
  `eip155:8453`, a payment timeout no greater than 900 seconds, and at most one challenge plus one
  paid retry. It verifies `resource`, `extensions.bazaar`, and `accepted` before sending the paid
  retry.
- The host transport must copy `PaymentRequired.resource` unchanged into
  `PaymentPayload.resource` and reject absent or conflicting resource metadata. Paid mode requires
  an explicit capability attestation for this discovery binding.
- Paid mode also requires a cumulative session budget. The plugin reserves catalog price before
  every eligible transport call, atomically blocking parallel calls that would exceed the budget.
- Reservations survive timeouts and transport failures because the plugin cannot prove that an
  opaque payment wrapper did not settle. Operators must review the host wallet before resetting
  the budget by creating a new client.
- A payment challenge is not evidence of payment. Only a validated HTTP 200 response is exposed as
  a successful action result.
- The plugin invokes its configured transport once. The included transport performs exactly one
  unpaid request and at most one paid retry; any third HTTP attempt is rejected.
- Full response bodies from non-200 responses and recipient fields from challenges are not exposed.
- The request deadline remains active through full body consumption. Response bytes are bounded
  during streaming, including chunked and transparently decompressed bodies.
- Arbitrary exception details from injected transports and response streams are replaced with
  bounded error categories before entering agent-visible output.

## Upstream dependency status

The Base V2 transport pins `@x402/fetch` and `@x402/evm` to `2.19.0`; both resolve
`@x402/core` `2.19.0`. `@elizaos/core` remains a peer dependency. At the 2026-07-18 baseline,
`npm audit --omit=dev` reports zero known production vulnerabilities. The development tree still
contains five low-severity upstream advisories and must be reassessed before release; silently
widening x402 versions or downgrading the framework to suppress an audit is not acceptable.

## Reporting

Use GitHub private vulnerability reporting for the canonical public repository. Do not open a
public issue for a suspected vulnerability and do not include live credentials, payment payloads,
recipient fields, or private wallet material in any report. Until the public repository exists,
retain the report locally rather than sending sensitive details through an unverified channel.
