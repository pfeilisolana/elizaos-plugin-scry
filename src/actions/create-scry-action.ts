import type { Action } from "@elizaos/core";
import { extractSolanaAddress } from "../address.js";
import type { ScryClient } from "../client.js";
import type { ScryProductDefinition } from "../types.js";

function formatCatalogPrice(priceUsd: number): string {
  return `$${priceUsd.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
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
    handler: async (_runtime, message) => {
      const text = typeof message.content.text === "string" ? message.content.text : "";
      const subject = definition.inputKind === "none" ? undefined : extractSolanaAddress(text);
      if (definition.inputKind !== "none" && !subject) {
        const subjectLabel = definition.inputKind === "mint" ? "token mint" : "wallet address";
        return {
          success: false,
          text: `A valid 32-byte Solana ${subjectLabel} is required.`,
          values: { scryStatus: "invalid_subject", scryInputKind: definition.inputKind },
          data: { status: "invalid_subject", inputKind: definition.inputKind },
        };
      }

      const result = await client.query(definition, subject);
      const subjectValues =
        subject && definition.subjectField ? { [definition.subjectField]: subject } : {};
      if (!result.ok) {
        const resultData: Record<string, unknown> = { ...result };
        return {
          success: false,
          text: result.message,
          values: {
            scryStatus: result.status,
            scryProduct: result.product,
            scryInputKind: result.inputKind,
            ...subjectValues,
          },
          data: resultData,
          error: new Error(result.message),
        };
      }

      const subjectText = subject ? ` for ${subject}` : "";
      return {
        success: true,
        text: `Scry returned ${definition.label}${subjectText}. The structured result is neutral evidence; caller-owned policy determines any action.`,
        values: {
          scryStatus: "success",
          scryProduct: result.product,
          scryInputKind: result.inputKind,
          ...subjectValues,
        },
        data: result.evidence,
      };
    },
  };
}
