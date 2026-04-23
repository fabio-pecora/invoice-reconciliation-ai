import "server-only";
import {
  InvoiceRow,
  MatchCandidate,
  TransactionRow,
} from "@/lib/matching/candidate-engine";
import { createStructuredJsonResponse } from "@/lib/llm/openai-server";

export type MatchDecisionType =
  | "unmatched"
  | "single_invoice"
  | "multi_invoice";

export type LlmDecisionAllocation = {
  invoice_id: string;
  amount: number;
};

export type LlmMatchDecision = {
  decision_type: MatchDecisionType;
  selected_invoice_ids: string[];
  proposed_allocations: LlmDecisionAllocation[];
  confidence: number;
  explanation: string;
};

export type ValidatedLlmMatchDecision = {
  decisionType: MatchDecisionType;
  selectedInvoiceIds: string[];
  allocations: LlmDecisionAllocation[];
  confidence: number;
  explanation: string;
};

type RequestLlmMatchDecisionInput = {
  transaction: TransactionRow;
  candidates: MatchCandidate[];
  paymentAmount: number;
};

type RequestLlmMatchDecisionResult =
  | {
      success: true;
      decision: LlmMatchDecision;
      requestId?: string;
      raw: string;
    }
  | {
      success: false;
      error: string;
      raw?: string;
      requestId?: string;
    };

type ValidationResult =
  | {
      valid: true;
      decision: ValidatedLlmMatchDecision;
    }
  | {
      valid: false;
      reason: string;
    };

const MONEY_EPSILON = 0.01;
const MATCH_DECISION_ALLOWED_KEYS = new Set([
  "decision_type",
  "selected_invoice_ids",
  "proposed_allocations",
  "confidence",
  "explanation",
]);

const LLM_MATCH_DECISION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "decision_type",
    "selected_invoice_ids",
    "proposed_allocations",
    "confidence",
    "explanation",
  ],
  properties: {
    decision_type: {
      type: "string",
      enum: ["unmatched", "single_invoice", "multi_invoice"],
    },
    selected_invoice_ids: {
      type: "array",
      items: {
        type: "string",
      },
    },
    proposed_allocations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["invoice_id", "amount"],
        properties: {
          invoice_id: {
            type: "string",
          },
          amount: {
            type: "number",
          },
        },
      },
    },
    confidence: {
      type: "number",
    },
    explanation: {
      type: "string",
    },
  },
};

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasDuplicateStrings(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

function isValidConfidence(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function buildSystemPrompt(): string {
  return [
    "You assist a deterministic invoice reconciliation engine.",
    "You are only used for ambiguous matching cases.",
    "Your job is to break reasonable fuzzy ambiguities without becoming reckless.",
    "Never invent invoice IDs or use invoice IDs outside the provided candidate list.",
    "Treat the candidate list as the only allowed invoice universe.",
    "Preserve payment total consistency: the allocation amounts must sum exactly to the usable incoming payment amount when you choose a match.",
    "In a matched decision, every selected invoice ID must be unique and must appear exactly once in proposed_allocations.",
    "In a matched decision, do not leave any payment amount unallocated and do not allocate more than the incoming payment amount.",
    "Choose a match when one candidate is meaningfully stronger than the others on the provided evidence, even if the names are not exact string matches.",
    "Prefer candidates with stronger identifier overlap such as store numbers, unique numeric fragments, or more specific wording.",
    "Do not reject an otherwise clear best candidate only because the transaction name includes extra noise words such as PAYMENT, ACH, TRANSFER, INC, or CORP.",
    "Do not force a match when two or more candidates are essentially tied on the meaningful signals.",
    "If you are uncertain, if the candidates are weak, or if no exact safe allocation exists, return unmatched.",
    "If the candidates are too weak or inconsistent, return unmatched.",
    "Return only valid JSON that matches the provided schema.",
  ].join("\n");
}

export function buildLlmMatchPrompt(
  input: RequestLlmMatchDecisionInput
): string {
  const serializedCandidates = input.candidates.map((candidate, index) => ({
    rank: index + 1,
    invoice_id: candidate.invoice_id,
    invoice_number: candidate.invoice_number,
    customer_name: candidate.customer_name,
    balance_due: candidate.balance_due,
    score: candidate.score,
    name_score: candidate.name_score,
    amount_score: candidate.amount_score,
    reason: candidate.reason,
  }));
  const allowedInvoiceIds = serializedCandidates.map(
    (candidate) => candidate.invoice_id
  );

  return [
    "Decide whether this incoming payment should stay unmatched, match one invoice, or match multiple invoices.",
    "This is an ambiguity-resolution task only. Deterministic logic already handled the clear cases.",
    "The candidate list is already ranked best-first by deterministic scoring, but you must still decide whether the best candidate is meaningfully better or whether the case is a true tie.",
    "",
    "Transaction:",
    JSON.stringify(
      {
        id: input.transaction.id,
        date: input.transaction.date,
        name: input.transaction.name,
        amount: input.transaction.amount,
        direction: input.transaction.direction,
        usable_incoming_payment_amount: input.paymentAmount,
      },
      null,
      2
    ),
    "",
    "Candidate invoices:",
    JSON.stringify(serializedCandidates, null, 2),
    "",
    "Allowed invoice IDs:",
    JSON.stringify(allowedInvoiceIds, null, 2),
    "",
    "Rules:",
    "- If you choose unmatched, selected_invoice_ids and proposed_allocations must both be empty arrays.",
    "- If you choose single_invoice, return exactly one selected invoice ID and one allocation.",
    "- If you choose multi_invoice, return at least two selected invoice IDs and at least two allocations.",
    "- selected_invoice_ids must not contain duplicates.",
    "- proposed_allocations must contain exactly one row per selected invoice_id.",
    "- Every proposed allocation amount must be positive.",
    `- The sum of proposed allocation amounts must equal ${input.paymentAmount}.`,
    "- Never leave leftover payment amount in a matched decision.",
    "- Never allocate more than the incoming payment amount.",
    "- Do not allocate more than a candidate invoice's balance_due.",
    "- Do not mention or use any invoice ID not listed above.",
    "- Choose a match when one candidate is clearly the best overall candidate, even if the wording is fuzzy rather than exact.",
    "- Prefer candidates with stronger identifier overlap such as store number matches, unique number fragments, or more specific shared wording.",
    "- A candidate that matches multiple meaningful tokens is stronger than one that only shares a broad brand token.",
    "- Extra transaction noise words such as PAYMENT, ACH, TRANSFER, INC, and CORP are weak evidence and should not by themselves block a match.",
    "- Do not return unmatched merely because the names are not exact if one candidate is still materially stronger than the rest.",
    "- Return unmatched when two or more candidates are essentially tied and there is no meaningful distinguishing signal.",
    "- Do not force a match based only on one generic shared brand token when multiple candidates remain equally plausible.",
    "- When uncertain, return unmatched.",
  ].join("\n");
}

function parseDecisionType(value: unknown): MatchDecisionType | null {
  return value === "unmatched" ||
    value === "single_invoice" ||
    value === "multi_invoice"
    ? value
    : null;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }

  return value.map((item) => item.trim());
}

function parseAllocations(value: unknown): LlmDecisionAllocation[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const allocations: LlmDecisionAllocation[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }

    if (
      typeof item.invoice_id !== "string" ||
      typeof item.amount !== "number" ||
      !Number.isFinite(item.amount)
    ) {
      return null;
    }

    allocations.push({
      invoice_id: item.invoice_id.trim(),
      amount: item.amount,
    });
  }

  return allocations;
}

export function parseLlmMatchDecision(raw: string): LlmMatchDecision | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  if (Object.keys(parsed).some((key) => !MATCH_DECISION_ALLOWED_KEYS.has(key))) {
    return null;
  }

  const decisionType = parseDecisionType(parsed.decision_type);
  const selectedInvoiceIds = parseStringArray(parsed.selected_invoice_ids);
  const allocations = parseAllocations(parsed.proposed_allocations);
  const confidence = parsed.confidence;
  const explanation = parsed.explanation;

  if (
    !decisionType ||
    !selectedInvoiceIds ||
    !allocations ||
    typeof confidence !== "number" ||
    !isValidConfidence(confidence) ||
    typeof explanation !== "string"
  ) {
    return null;
  }

  return {
    decision_type: decisionType,
    selected_invoice_ids: selectedInvoiceIds,
    proposed_allocations: allocations,
    confidence,
    explanation,
  };
}

export async function requestLlmMatchDecision(
  input: RequestLlmMatchDecisionInput
): Promise<RequestLlmMatchDecisionResult> {
  const response = await createStructuredJsonResponse({
    systemPrompt: buildSystemPrompt(),
    userPrompt: buildLlmMatchPrompt(input),
    schemaName: "invoice_reconciliation_decision",
    schema: LLM_MATCH_DECISION_SCHEMA,
  });

  if (!response.success) {
    return {
      success: false,
      error: response.error,
    };
  }

  const decision = parseLlmMatchDecision(response.content);

  if (!decision) {
    return {
      success: false,
      error: "LLM returned invalid structured JSON.",
      raw: response.content,
      requestId: response.requestId,
    };
  }

  return {
    success: true,
    decision,
    requestId: response.requestId,
    raw: response.content,
  };
}

export function validateLlmMatchDecision(input: {
  transaction: TransactionRow;
  decision: LlmMatchDecision;
  candidates: MatchCandidate[];
  invoices: InvoiceRow[];
}): ValidationResult {
  if (input.transaction.direction !== "incoming") {
    return {
      valid: false,
      reason: "Stored for completeness, but not eligible for invoice matching.",
    };
  }

  const paymentAmount = roundMoney(Math.abs(Number(input.transaction.amount)));

  if (paymentAmount <= 0) {
    return {
      valid: false,
      reason: "Incoming payment amount must be positive.",
    };
  }

  const candidateIdSet = new Set(
    input.candidates.map((candidate) => candidate.invoice_id)
  );
  const invoiceLookup = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const selectedInvoiceIds = input.decision.selected_invoice_ids.map((invoiceId) =>
    invoiceId.trim()
  );
  const normalizedAllocations = input.decision.proposed_allocations.map(
    (allocation) => ({
      invoice_id: allocation.invoice_id.trim(),
      amount: roundMoney(Number(allocation.amount)),
    })
  );
  const explanation = input.decision.explanation.trim();

  if (!isValidConfidence(input.decision.confidence)) {
    return {
      valid: false,
      reason: "LLM confidence must be a number between 0 and 1.",
    };
  }

  if (!explanation) {
    return {
      valid: false,
      reason: "LLM explanation must be a non-empty string.",
    };
  }

  if (selectedInvoiceIds.some((invoiceId) => !invoiceId)) {
    return {
      valid: false,
      reason: "LLM selected invoice IDs must be non-empty strings.",
    };
  }

  if (hasDuplicateStrings(selectedInvoiceIds)) {
    return {
      valid: false,
      reason: "LLM selected invoice IDs must be unique.",
    };
  }

  for (const invoiceId of selectedInvoiceIds) {
    if (!candidateIdSet.has(invoiceId)) {
      return {
        valid: false,
        reason: `LLM selected invoice ${invoiceId} outside the candidate list.`,
      };
    }
  }

  for (const allocation of normalizedAllocations) {
    if (!allocation.invoice_id) {
      return {
        valid: false,
        reason: "LLM allocation invoice IDs must be non-empty strings.",
      };
    }

    if (!candidateIdSet.has(allocation.invoice_id)) {
      return {
        valid: false,
        reason: `LLM allocated invoice ${allocation.invoice_id} outside the candidate list.`,
      };
    }

    if (!Number.isFinite(allocation.amount) || allocation.amount <= 0) {
      return {
        valid: false,
        reason: "LLM allocation amounts must be numeric and positive.",
      };
    }
  }

  if (input.decision.decision_type === "unmatched") {
    if (selectedInvoiceIds.length > 0 || normalizedAllocations.length > 0) {
      return {
        valid: false,
        reason: "Unmatched LLM decisions must not include invoice selections or allocations.",
      };
    }

    return {
      valid: true,
      decision: {
        decisionType: "unmatched",
        selectedInvoiceIds: [],
        allocations: [],
        confidence: Number(input.decision.confidence.toFixed(4)),
        explanation,
      },
    };
  }

  if (selectedInvoiceIds.length === 0 || normalizedAllocations.length === 0) {
    return {
      valid: false,
      reason: "Matched LLM decisions must include selected invoice IDs and allocations.",
    };
  }

  const allocationInvoiceIds = normalizedAllocations.map(
    (allocation) => allocation.invoice_id
  );
  const uniqueAllocationInvoiceIds = new Set(allocationInvoiceIds);

  if (uniqueAllocationInvoiceIds.size !== allocationInvoiceIds.length) {
    return {
      valid: false,
      reason: "LLM allocations cannot include the same invoice more than once.",
    };
  }

  if (selectedInvoiceIds.length !== uniqueAllocationInvoiceIds.size) {
    return {
      valid: false,
      reason: "LLM selected invoice IDs must exactly match the allocation invoice IDs.",
    };
  }

  for (const invoiceId of selectedInvoiceIds) {
    if (!uniqueAllocationInvoiceIds.has(invoiceId)) {
      return {
        valid: false,
        reason: "LLM selected invoice IDs must exactly match the allocation invoice IDs.",
      };
    }
  }

  if (
    input.decision.decision_type === "single_invoice" &&
    (selectedInvoiceIds.length !== 1 || normalizedAllocations.length !== 1)
  ) {
    return {
      valid: false,
      reason: "Single-invoice LLM decisions must include exactly one invoice and one allocation.",
    };
  }

  if (
    input.decision.decision_type === "multi_invoice" &&
    (selectedInvoiceIds.length < 2 || normalizedAllocations.length < 2)
  ) {
    return {
      valid: false,
      reason: "Multi-invoice LLM decisions must include at least two invoices and two allocations.",
    };
  }

  let totalAllocated = 0;

  for (const allocation of normalizedAllocations) {
    const invoice = invoiceLookup.get(allocation.invoice_id);

    if (!invoice) {
      return {
        valid: false,
        reason: `Invoice ${allocation.invoice_id} is no longer eligible for matching.`,
      };
    }

    if (allocation.amount - roundMoney(Number(invoice.balance_due)) > MONEY_EPSILON) {
      return {
        valid: false,
        reason: `LLM allocation exceeds balance due for invoice ${allocation.invoice_id}.`,
      };
    }

    totalAllocated = roundMoney(totalAllocated + allocation.amount);
  }

  if (Math.abs(totalAllocated - paymentAmount) > MONEY_EPSILON) {
    return {
      valid: false,
      reason: "LLM allocations must sum exactly to the usable incoming payment amount.",
    };
  }

  return {
    valid: true,
    decision: {
      decisionType: input.decision.decision_type,
      selectedInvoiceIds,
      allocations: normalizedAllocations,
      confidence: Number(input.decision.confidence.toFixed(4)),
      explanation,
    },
  };
}
