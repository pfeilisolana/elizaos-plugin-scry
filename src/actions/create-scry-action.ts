import type { Action, ActionResult, Content, HandlerCallback } from "@elizaos/core";
import { extractSolanaAddress } from "../address.js";
import type { ScryClient } from "../client.js";
import type { ScryProductDefinition } from "../types.js";

function formatCatalogPrice(priceUsd: number): string {
  return `$${priceUsd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatPaymentRequiredText(
  definition: ScryProductDefinition,
  catalogPriceUsd: number,
  networks: readonly string[],
): string {
  const networkText =
    networks.length > 0
      ? `The unpaid 402 advertised ${networks.join(", ")}.`
      : "The unpaid 402 did not expose a usable payment network.";
  const purchaseText = networks.includes("eip155:8453")
    ? "To purchase through this plugin, configure x402 mode with a host-owned Base signer and explicit per-request and session ceilings at or above the catalog price."
    : "The bundled paid transport cannot purchase this quote because Base (eip155:8453) was not advertised.";

  return [
    `Scry ${definition.label} has a catalog price of ${formatCatalogPrice(catalogPriceUsd)}; the live challenge price was not independently verified.`,
    networkText,
    "No payment was attempted and no settlement was confirmed.",
    purchaseText,
  ].join(" ");
}

async function deliverActionResult(
  callback: HandlerCallback | undefined,
  actionName: string,
  result: ActionResult,
): Promise<ActionResult> {
  if (callback) {
    const content: Content = {
      ...(result.text !== undefined ? { text: result.text } : {}),
      actions: [actionName],
      ...(result.values?.scryStatus !== undefined ? { scryStatus: result.values.scryStatus } : {}),
      ...(result.values?.scryProduct !== undefined
        ? { scryProduct: result.values.scryProduct }
        : {}),
      ...(result.values?.scryCatalogPriceUsd !== undefined
        ? { scryCatalogPriceUsd: result.values.scryCatalogPriceUsd }
        : {}),
      ...(result.values?.scryQuoteNetworks !== undefined
        ? { scryQuoteNetworks: result.values.scryQuoteNetworks }
        : {}),
      ...(result.values?.scryChallengePriceVerified !== undefined
        ? { scryChallengePriceVerified: result.values.scryChallengePriceVerified }
        : {}),
      ...(result.values?.scryPaymentAttempted !== undefined
        ? { scryPaymentAttempted: result.values.scryPaymentAttempted }
        : {}),
      ...(result.values?.scrySettlementConfirmed !== undefined
        ? { scrySettlementConfirmed: result.values.scrySettlementConfirmed }
        : {}),
      ...(result.values?.scryPaidTransportSupported !== undefined
        ? { scryPaidTransportSupported: result.values.scryPaidTransportSupported }
        : {}),
    };
    await callback(content);
  }
  return result;
}

export function createScryAction(definition: ScryProductDefinition, client: ScryClient): Action {
  const exampleSubject = "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk";
  const exampleText =
    definition.inputKind === "none"
      ? `Get ${definition.label}`
      : `Get ${definition.label} for ${exampleSubject}`;

  return {
    name: definition.actionName,
    description: [
      definition.description,
      `Catalog price ${formatCatalogPrice(definition.priceUsd)}.`,
      `Use when: ${definition.buyerIntent}`,
      definition.notFor,
    ].join(" "),
    similes: [...definition.similes],
    examples: [
      [
        {
          name: "{{user}}",
          content: {
            text: exampleText,
          },
        },
        {
          name: "{{agent}}",
          content: {
            text: `I will retrieve neutral ${definition.label} from Scry at a catalog price of ${formatCatalogPrice(definition.priceUsd)}.`,
            actions: [definition.actionName],
          },
        },
      ],
    ],
    validate: async (_runtime, message) => {
      if (definition.inputKind === "none") return true;
      const text = typeof message.content.text === "string" ? message.content.text : "";
      return extractSolanaAddress(text) !== undefined;
    },
    handler: async (_runtime, message, _state, _options, callback) => {
      const text = typeof message.content.text === "string" ? message.content.text : "";
      const subject = definition.inputKind === "none" ? undefined : extractSolanaAddress(text);
      if (definition.inputKind !== "none" && !subject) {
        const subjectLabel = definition.inputKind === "mint" ? "token mint" : "wallet address";
        return deliverActionResult(callback, definition.actionName, {
          success: false,
          text: `A valid 32-byte Solana ${subjectLabel} is required.`,
          values: { scryStatus: "invalid_subject", scryInputKind: definition.inputKind },
          data: { status: "invalid_subject", inputKind: definition.inputKind },
        });
      }

      const result = await client.query(definition, subject);
      const subjectValues =
        subject && definition.subjectField ? { [definition.subjectField]: subject } : {};
      if (!result.ok) {
        const paymentRequired = result.status === "payment_required";
        const paidTransportSupported =
          paymentRequired && result.quote.networks.includes("eip155:8453");
        const resultText = paymentRequired
          ? formatPaymentRequiredText(
              definition,
              result.quote.catalogPriceUsd,
              result.quote.networks,
            )
          : result.message;
        const resultData: Record<string, unknown> = { ...result };
        return deliverActionResult(callback, definition.actionName, {
          success: false,
          text: resultText,
          values: {
            scryStatus: result.status,
            scryProduct: result.product,
            scryInputKind: result.inputKind,
            ...(paymentRequired
              ? {
                  scryCatalogPriceUsd: result.quote.catalogPriceUsd,
                  scryQuoteNetworks: result.quote.networks,
                  scryChallengePriceVerified: result.quote.challengePriceVerified,
                  scryPaymentAttempted: false,
                  scrySettlementConfirmed: false,
                  scryPaidTransportSupported: paidTransportSupported,
                }
              : {}),
            ...subjectValues,
          },
          data: resultData,
          error: new Error(resultText),
        });
      }

      const subjectText = subject ? ` for ${subject}` : "";
      return deliverActionResult(callback, definition.actionName, {
        success: true,
        text: `Scry returned ${definition.label}${subjectText}. The structured result is neutral evidence; caller-owned policy determines any action.`,
        values: {
          scryStatus: "success",
          scryProduct: result.product,
          scryInputKind: result.inputKind,
          ...subjectValues,
        },
        data: result.evidence,
      });
    },
  };
}
