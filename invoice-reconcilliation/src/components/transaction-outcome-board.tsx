"use client";

import Link from "next/link";
import { useState } from "react";
import {
  MatchRow,
  formatMatchStatusLabel,
  isAppliedMatchStatus,
} from "@/lib/matching/match-status";
import {
  getMatchActionLabel,
  getOriginBadgeClass,
  getShortMatchExplanation,
  getStatusBadgeClass,
  inferMatchOrigin,
} from "@/lib/matching/match-ui";

type TransactionRow = {
  id: string;
  plaid_transaction_id: string;
  date: string;
  name: string;
  amount: number;
  direction: "incoming" | "outgoing";
};

type TransactionListItem = {
  transaction: TransactionRow;
  match: MatchRow | null;
};

type OutcomeSection = {
  id: string;
  title: string;
  description: string;
  emptyMessage: string;
  items: TransactionListItem[];
};

type TransactionOutcomeBoardProps = {
  items: TransactionListItem[];
  showOriginBadge?: boolean;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDirectionLabel(direction: TransactionRow["direction"]): string {
  return direction === "incoming" ? "Incoming" : "Outgoing";
}

function getDirectionBadgeClass(direction: TransactionRow["direction"]): string {
  return direction === "incoming"
    ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
    : "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function buildIncomingSections(items: TransactionListItem[]): OutcomeSection[] {
  return [
    {
      id: "applied",
      title: "Applied",
      description:
        "Incoming payments with persisted invoice allocations, including partial and multi-invoice applications.",
      emptyMessage: "No applied incoming transactions yet.",
      items: items.filter(
        (item) => item.match !== null && isAppliedMatchStatus(item.match.status)
      ),
    },
    {
      id: "review-needed",
      title: "Review Needed",
      description:
        "Plausible invoice candidates were found, but the system intentionally avoided an unsafe automatic choice.",
      emptyMessage: "No incoming transactions are waiting for review.",
      items: items.filter(
        (item) => item.match?.status === "human_review_needed"
      ),
    },
    {
      id: "unmatched",
      title: "Unmatched",
      description:
        "Incoming transactions that were processed and left unapplied because no plausible invoice fit was found.",
      emptyMessage: "No unmatched incoming transactions.",
      items: items.filter((item) => item.match?.status === "unmatched"),
    },
    {
      id: "pending",
      title: "Pending / Not Processed",
      description:
        "Incoming transactions without a persisted match row yet.",
      emptyMessage: "No pending incoming transactions.",
      items: items.filter((item) => item.match === null),
    },
  ];
}

function getSectionContainerClass(sectionId: string): string {
  if (sectionId === "review-needed") {
    return "overflow-hidden rounded-2xl border border-orange-200 bg-orange-50/50 shadow-sm";
  }

  return "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm";
}

function renderTransactionRow(
  item: TransactionListItem,
  showOriginBadge: boolean
) {
  const { transaction, match } = item;
  const origin = inferMatchOrigin(match);

  return (
    <Link
      key={transaction.id}
      href={`/reconciliation/${transaction.id}`}
      className={`block hover:bg-slate-50 ${
        match?.status === "human_review_needed" ? "bg-orange-50/70" : ""
      }`}
    >
      <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-base font-semibold text-slate-900">
              {transaction.name}
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${getDirectionBadgeClass(
                transaction.direction
              )}`}
            >
              {formatDirectionLabel(transaction.direction)}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                match?.status ?? "pending"
              )}`}
            >
              {formatMatchStatusLabel(match?.status ?? "pending")}
            </span>
            {showOriginBadge && origin ? (
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${getOriginBadgeClass(
                  origin
                )}`}
              >
                {origin}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            <span>{transaction.date}</span>
            <span>{transaction.plaid_transaction_id}</span>
            {match ? (
              <span>Confidence {Number(match.confidence).toFixed(2)}</span>
            ) : null}
          </div>

          <p className="truncate text-sm text-slate-600">
            {getShortMatchExplanation(match)}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 xl:justify-end">
          <div
            className={`text-right text-lg font-semibold ${
              transaction.direction === "incoming"
                ? "text-emerald-700"
                : "text-slate-900"
            }`}
          >
            {formatMoney(Number(transaction.amount))}
          </div>
          <span
            className={`inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium ${
              match?.status === "human_review_needed"
                ? "bg-orange-600 text-white"
                : "bg-blue-600 text-white"
            }`}
          >
            {getMatchActionLabel(match)}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function TransactionOutcomeBoard({
  items,
  showOriginBadge = false,
}: TransactionOutcomeBoardProps) {
  const [showOutgoing, setShowOutgoing] = useState(false);
  const incomingItems = items.filter(
    (item) => item.transaction.direction === "incoming"
  );
  const outgoingItems = items.filter(
    (item) => item.transaction.direction === "outgoing"
  );
  const incomingSections = buildIncomingSections(incomingItems);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {incomingSections.map((section) => (
          <div
            key={section.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="text-sm text-slate-500">{section.title}</div>
            <div className="mt-2 text-2xl font-semibold text-slate-900">
              {section.items.length}
            </div>
            <p className="mt-2 text-sm text-slate-600">{section.description}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900">
              Incoming transactions stay in focus
            </h2>
            <p className="text-sm text-slate-600">
              Stored for completeness, but not eligible for invoice matching.
              Outgoing activity stays hidden from the main reconciliation flow
              by default.
            </p>
            <p className="text-sm text-slate-500">
              {showOutgoing
                ? `Showing ${outgoingItems.length} outgoing transactions in a separate section below.`
                : `${outgoingItems.length} outgoing transactions are currently hidden.`}
            </p>
          </div>

          <label className="inline-flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={showOutgoing}
              onChange={(event) => setShowOutgoing(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Show outgoing transactions
          </label>
        </div>
      </section>

      {incomingItems.length === 0 && outgoingItems.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          No transactions found.
        </div>
      ) : (
        <div className="space-y-6">
          {incomingSections.map((section) => (
            <section
              key={section.id}
              className={getSectionContainerClass(section.id)}
            >
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      {section.title}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {section.description}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-medium ${
                      section.id === "review-needed"
                        ? "bg-orange-100 text-orange-900 ring-1 ring-orange-200"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {section.items.length}
                  </span>
                </div>
              </div>

              {section.items.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  {section.emptyMessage}
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {section.items.map((item) =>
                    renderTransactionRow(item, showOriginBadge)
                  )}
                </div>
              )}
            </section>
          ))}

          {showOutgoing ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium text-slate-900">
                      Outgoing / Ignored
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Stored for completeness, but not eligible for invoice
                      matching.
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                    {outgoingItems.length}
                  </span>
                </div>
              </div>

              {outgoingItems.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  No outgoing transactions found.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {outgoingItems.map((item) =>
                    renderTransactionRow(item, showOriginBadge)
                  )}
                </div>
              )}
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
