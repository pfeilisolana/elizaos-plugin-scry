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

The Base V2 transport pins `@x402/fetch` and `@x402/evm` to `2.21.0`; both resolve
`@x402/core` `2.21.0`. `@elizaos/core` remains an external peer dependency. At the 2026-08-08
baseline, `npm audit --omit=dev` reports zero known production vulnerabilities and the complete
development tree reports no high-or-critical vulnerabilities. The development lockfile overrides
the vulnerable transitive `pdfjs-dist` line to `6.2.108`, which requires Node.js 22.13.0 or newer;
the plugin runtime and CI support floor matches that requirement. The remaining five low-severity
audit nodes all trace to the same `elliptic` advisory in the pinned `@elizaos/core@1.7.2`
development host. No fixed stable `elliptic` or compatible stable ElizaOS Core release exists at
this baseline. The plugin build externalizes ElizaOS Core, so this tree is not bundled in the
published artifact. CI blocks any high-or-critical development-tree regression and any
low-or-higher production-tree regression. Silently widening x402 versions, using an unreleased
framework build, or downgrading the framework to suppress an audit is not acceptable.

## Release supply chain

The `0.1.0` bootstrap credential was temporary and is no longer part of the repository or GitHub
environment. Future npm versions are bound to the manually dispatched `release.yml` workflow, an
immutable version tag reachable from `main`, the `npm-production` GitHub environment, Node 24, npm
11.5.1, pinned GitHub actions, OIDC trusted publishing, full release gates, and public metadata
readback. The workflow contains no npm write token or generic GitHub secret reference and rejects
automatic push, pull-request, schedule, and reusable-workflow triggers. npm package settings should
disallow traditional token publishing; the OIDC publisher remains the only automated write path.

## Reporting

Use GitHub private vulnerability reporting for the canonical public repository. Do not open a
public issue for a suspected vulnerability and do not include live credentials, payment payloads,
recipient fields, or private wallet material in any report.
