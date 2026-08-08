# ElizaOS Plugin for Scry

Evidence-only ElizaOS actions for Scry's Solana wallet, mint, and cohort products. This public
repository contains the `0.1.0` release candidate. The npm package remains locked with
`private: true`; it has not been published or submitted to the ElizaOS registry.

## Safety model

- The default mode is `quote-only`. It can receive a `402` challenge but cannot pay it.
- A `402` is returned as `success: false` and is never described as a settlement.
- The plugin accepts no wallet keys and performs no network call during import, plugin creation,
  action validation, or provider evaluation.
- Paid mode can use the included Base V2 transport or an injected x402-capable fetch. The plugin
  ceiling and the transport's independently enforced ceiling must be identical.
- Paid mode also requires an explicit host attestation that the transport copies
  `PaymentRequired.resource` unchanged into `PaymentPayload.resource`. Scry emits the production
  resource as `{ url }` only for Coinbase facilitator compatibility; rich descriptions, schemas,
  branding, and route metadata remain in `extensions.bazaar` and the free discovery surfaces.
- The included Base transport sends exactly one x402 v2 `PAYMENT-SIGNATURE` header. It never sends
  `PAYMENT-SIGNATURE` and legacy `X-PAYMENT` together.
- Paid mode also requires a cumulative session budget. Each eligible call reserves its catalog
  price synchronously before the opaque payment transport runs, so concurrent actions cannot
  multiply spending beyond that budget.
- Reservations are deliberately retained after transport failures because settlement outcome is
  ambiguous. Review the host wallet before creating a fresh client and budget.
- Each action performs at most one transport call. The included Base transport permits exactly one
  unpaid challenge request and one paid retry; it rejects any third HTTP attempt.
- When the ElizaOS host provides a callback, each action emits exactly one bounded user-facing
  result while retaining the validated structured evidence in the action result.
- Requests are restricted to the seven exact canonical Scry product routes and their declared
  wallet, mint, or parameterless input shape.
- The deadline covers headers and the complete response body. Chunked and decompressed bytes are
  counted while streaming and the body is cancelled immediately when the configured limit is
  crossed.
- Transport and body-stream exception details are not returned to the agent.
- Successful responses must match the requested wallet and product constant before they are
  returned to the agent. The complete nested output schema is validated by deterministic Ajv
  standalone validators pinned to the public Scry manifest.

## Products

| Action | Product | Price ceiling needed |
| --- | --- | ---: |
| `SCRY_WALLET_QUICK_FLAG` | Lowest-cost wallet prefilter | $0.001 |
| `SCRY_WALLET_LINEAGE` | Funding lineage | $0.03 |
| `SCRY_WALLET_FORENSICS` | Wallet forensics | $0.05 |
| `SCRY_LAUNCH_WINDOW_CLUSTER` | Launch-window cluster evidence | $0.05 |
| `SCRY_WALLET_FULL_CONTEXT_PRO` | Full context with edge-gap reconciliation | $0.18 |
| `SCRY_PERSISTENT_WALLETS_WEEKLY` | Weekly persistent-wallet cohort | $0.20 |
| `SCRY_PUMPFUN_LAUNCH_DOSSIER` | One-mint creator and launch dossier | $0.30 |

Prices and response contracts are pinned to Scry's public discovery manifest and rechecked by the
release gate. Runtime contract validation fails closed if the service response diverges.

## Compatibility and installation

This `0.1.x` line targets the current stable ElizaOS v1 runtime: `@elizaos/core` `1.7.2`. CI tests
Node.js 22 and 24; Node.js 22.13.0 is the minimum supported runtime. ElizaOS 2.x/alpha
compatibility is not claimed by this release line. The
package is ESM-only; CommonJS hosts must load it with dynamic `import()` rather than `require()`.

The package declares no environment variables or plugin secrets. Its `agentConfig` is intentionally
empty because quote-only mode needs no credentials and paid mode accepts only a host-owned signer
object in code; never place a wallet key in an environment variable for this plugin.

After the separately authorized first npm release, install the package with its stable peer:

```sh
npm install @scrysolanahub/plugin-scry @elizaos/core@^1.7.2
```

Until then, this repository remains a public release candidate and the npm command above is not
expected to resolve.

## Usage

Quote-only is the default and safest integration:

```ts
import scryPlugin from "@scrysolanahub/plugin-scry";

// Add this object to the ProjectAgent.plugins array in the host application.
export const plugins = [scryPlugin];
```

For paid requests on Base, pass a host-owned EVM signer to the included V2 transport. The signer is
structural (`address` plus `signTypedData`); do not pass a raw private key to Scry or this package:

```ts
import {
  createScryBaseX402Transport,
  createScryPlugin,
  SCRY_BUDGET_PROFILES,
} from "@scrysolanahub/plugin-scry";

// Obtain this from the host wallet subsystem. A viem LocalAccount is compatible.
const evmSigner = hostWallet.getEvmSigner();
const budget = SCRY_BUDGET_PROFILES.PREFLIGHT;
const transport = createScryBaseX402Transport({
  signer: evmSigner,
  maxPaymentUsd: budget.perRequestCeilingUsd,
});

const scryPlugin = createScryPlugin({
  transport,
  maxPaymentUsd: budget.perRequestCeilingUsd,
  sessionBudgetUsd: budget.sessionBudgetUsd,
});
```

The `PREFLIGHT` profile deliberately permits only the four products priced at `$0.05` or less. It
will fail locally before transport if an agent selects Full Context (`$0.18`), Persistent Wallets
Weekly (`$0.20`), or Pump.fun Launch Dossier (`$0.30`). This is the safer default for focused wallet
triage.

Use the explicit `FULL_CATALOG` profile only when the host intends to make all seven actions
available. Its `$0.60` session ceiling permits at most two maximum-price reservations; failed or
ambiguous transports still retain their reservation:

```ts
const budget = SCRY_BUDGET_PROFILES.FULL_CATALOG;
const transport = createScryBaseX402Transport({
  signer: evmSigner,
  maxPaymentUsd: budget.perRequestCeilingUsd,
});

const scryPlugin = createScryPlugin({
  transport,
  maxPaymentUsd: budget.perRequestCeilingUsd,
  sessionBudgetUsd: budget.sessionBudgetUsd,
});
```

Every action description exposes its exact catalog price, intended use, and non-fit boundary. The
static capability provider returns the same structured routing fields plus lower-cost and
more-complete alternatives. Agents should choose the narrowest product that fully answers the
request, not the highest-priced product by default.

The included transport is pinned to `@x402/fetch` and `@x402/evm` 2.21.0. It only selects Base
mainnet (`eip155:8453`) exact USDC requirements, rejects challenge amounts above the declared
ceiling before signing, requires the canonical Scry URL and Bazaar extension, and verifies that
the generated payload preserves `resource`, `extensions.bazaar`, and `accepted` exactly.

Do not substitute `createX402Fetch` from the current `@elizaos/plugin-wallet` release: its network
identifier is `base:8453`, while Scry and x402 V2 use CAIP-2 `eip155:8453`. Use the included Base
transport until that upstream client is V2-compatible.

An opaque custom transport remains supported, but its ceiling and
`paymentPayloadResource: "payment-required-resource-exact"` fields are host attestations that this
plugin cannot independently inspect.
The plugin's separate session budget is a conservative reservation ceiling, not a settlement
ledger. Recreate the client only after reviewing ambiguous payment outcomes.

## Development

Requires Node.js 22.13.0 or newer.

```sh
npm ci
npm run check
npm run test:coverage
npm run contracts:check
npm run release:registry-check
```

`contracts:verify` is offline and proves that the pinned snapshot and generated validators are
byte-consistent. `contracts:check` performs a free, read-only fetch of the public manifest and fails
closed on path, product, price, output-schema drift, invalid encoding, or a response larger than 4
MiB. `contracts:sync` is the explicit maintainer operation that updates the snapshot and generated
validators after reviewed contract changes.

`release:registry-check` independently verifies the current ElizaOS monorepo registry schema and
submission instructions against pinned bytes and semantics. Registry submission remains a separate
external action after repository creation and first npm publish.

`@elizaos/core` is a peer dependency. Development pins version `1.7.2` so CI tests the exact
compatibility target rather than an unbounded `latest` release.

## Non-goals

The plugin does not provide trading instructions, verdicts, policy decisions, wallet custody,
automatic refreshes, database writes, or unattended spending. Scry output is evidence context;
the caller owns policy and action decisions.
