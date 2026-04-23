"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
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
import ProcessPendingTransactionsButton from "@/components/process-pending-transactions-button";

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

type SectionId =
  | "applied"
  | "review-needed"
  | "unmatched"
  | "pending"
  | "outgoing";

type SectionTone = {
  containerClass: string;
  headerClass: string;
  headerTitleClass: string;
  countBadgeClass: string;
  summaryDotClass: string;
};

type OutcomeSectionConfig = {
  id: Exclude<SectionId, "outgoing">;
  title: string;
  description: string;
  emptyMessage: string;
  matches: (item: TransactionListItem) => boolean;
  tone: SectionTone;
};

type OutcomeSection = Omit<OutcomeSectionConfig, "matches"> & {
  items: TransactionListItem[];
};

type TransactionOutcomeBoardProps = {
  items: TransactionListItem[];
  showOriginBadge?: boolean;
};

const SECTION_PAGE_SIZE = 5;

const SECTION_TONES: Record<SectionId, SectionTone> = {
  applied: {
    containerClass:
      "overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm",
    headerClass: "border-b border-emerald-100 bg-emerald-50/80",
    headerTitleClass: "text-emerald-950",
    countBadgeClass:
      "rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-900 ring-1 ring-emerald-200",
    summaryDotClass: "bg-emerald-400",
  },
  "review-needed": {
    containerClass:
      "overflow-hidden rounded-2xl border border-amber-200 bg-white shadow-sm",
    headerClass: "border-b border-amber-100 bg-amber-50/90",
    headerTitleClass: "text-amber-950",
    countBadgeClass:
      "rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900 ring-1 ring-amber-200",
    summaryDotClass: "bg-amber-400",
  },
  unmatched: {
    containerClass:
      "overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-sm",
    headerClass: "border-b border-rose-100 bg-rose-50/80",
    headerTitleClass: "text-rose-950",
    countBadgeClass:
      "rounded-full bg-rose-100 px-3 py-1 text-sm font-medium text-rose-900 ring-1 ring-rose-200",
    summaryDotClass: "bg-rose-400",
  },
  pending: {
    containerClass:
      "overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm",
    headerClass: "border-b border-sky-100 bg-sky-50/80",
    headerTitleClass: "text-sky-950",
    countBadgeClass:
      "rounded-full bg-sky-100 px-3 py-1 text-sm font-medium text-sky-900 ring-1 ring-sky-200",
    summaryDotClass: "bg-sky-400",
  },
  outgoing: {
    containerClass:
      "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm",
    headerClass: "border-b border-slate-200 bg-slate-50/90",
    headerTitleClass: "text-slate-900",
    countBadgeClass:
      "rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200",
    summaryDotClass: "bg-slate-400",
  },
};

const INCOMING_SECTION_CONFIGS: OutcomeSectionConfig[] = [
  {
    id: "applied",
    title: "Applied",
    description:
      "Incoming payments with persisted invoice allocations, including partial and multi-invoice applications.",
    emptyMessage: "No applied incoming transactions yet.",
    matches: (item) =>
      item.match !== null && isAppliedMatchStatus(item.match.status),
    tone: SECTION_TONES.applied,
  },
  {
    id: "review-needed",
    title: "Review Needed",
    description:
      "Plausible invoice candidates were found, but the system intentionally avoided an unsafe automatic choice.",
    emptyMessage: "No incoming transactions are waiting for review.",
    matches: (item) => item.match?.status === "human_review_needed",
    tone: SECTION_TONES["review-needed"],
  },
  {
    id: "unmatched",
    title: "Unmatched",
    description:
      "Incoming transactions that were processed and left unapplied because no plausible invoice fit was found.",
    emptyMessage: "No unmatched incoming transactions.",
    matches: (item) => item.match?.status === "unmatched",
    tone: SECTION_TONES.unmatched,
  },
  {
    id: "pending",
    title: "Pending / Not Processed",
    description:
      "Transactions waiting for reconciliation. Run matching to compare them against open invoices.",
    emptyMessage: "No pending incoming transactions.",
    matches: (item) => item.match === null,
    tone: SECTION_TONES.pending,
  },
];

const INITIAL_PAGE_BY_SECTION: Record<SectionId, number> = {
  applied: 1,
  "review-needed": 1,
  unmatched: 1,
  pending: 1,
  outgoing: 1,
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
  return INCOMING_SECTION_CONFIGS.map(({ matches, ...section }) => ({
    ...section,
    items: items.filter(matches),
  }));
}

function matchesSearch(
  item: TransactionListItem,
  normalizedSearchQuery: string
): boolean {
  if (!normalizedSearchQuery) {
    return true;
  }

  const { transaction } = item;
  const searchFields = [
    transaction.name,
    transaction.plaid_transaction_id,
    transaction.date,
    String(transaction.amount),
    formatMoney(Number(transaction.amount)),
  ];

  return searchFields.some((value) =>
    value.toLowerCase().includes(normalizedSearchQuery)
  );
}

function getPaginationState(itemCount: number, requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(itemCount / SECTION_PAGE_SIZE));
  const currentPage = Math.min(Math.max(requestedPage, 1), totalPages);
  const startIndex = (currentPage - 1) * SECTION_PAGE_SIZE;

  return {
    currentPage,
    totalPages,
    items: itemCount > 0 ? [startIndex, startIndex + SECTION_PAGE_SIZE] : null,
    showControls: itemCount > SECTION_PAGE_SIZE,
  };
}

function renderTransactionRow(
  item: TransactionListItem,
  showOriginBadge: boolean
) {
  const { transaction, match } = item;
  const origin = inferMatchOrigin(match);
  const isReviewNeeded = match?.status === "human_review_needed";

  return (
    <Link
      key={transaction.id}
      href={`/reconciliation/${transaction.id}`}
      className={`block transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-inset ${
        isReviewNeeded ? "bg-amber-50/40 hover:bg-amber-50/70" : ""
      }`}
    >
      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
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
            <span className="break-all">{transaction.plaid_transaction_id}</span>
            {match ? (
              <span>Confidence {Number(match.confidence).toFixed(2)}</span>
            ) : null}
          </div>

          <p className="truncate text-sm text-slate-600">
            {getShortMatchExplanation(match)}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 lg:justify-end">
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
            className={`inline-flex items-center rounded-lg px-3.5 py-2 text-sm font-medium shadow-sm ring-1 ${
              isReviewNeeded
                ? "bg-amber-600 text-white ring-amber-500"
                : "bg-slate-900 text-white ring-slate-800"
            }`}
          >
            {getMatchActionLabel(match)}
          </span>
        </div>
      </div>
    </Link>
  );
}

type SectionCardProps = {
  section: {
    id: SectionId;
    title: string;
    description: string;
    emptyMessage: string;
    items: TransactionListItem[];
    tone: SectionTone;
  };
  showOriginBadge: boolean;
  requestedPage: number;
  searchActive: boolean;
  onPageChange: (sectionId: SectionId, nextPage: number) => void;
  className?: string;
  headerAction?: ReactNode;
};

function SectionCard({
  section,
  showOriginBadge,
  requestedPage,
  searchActive,
  onPageChange,
  className = "",
  headerAction,
}: SectionCardProps) {
  const pagination = getPaginationState(section.items.length, requestedPage);
  const pagedItems =
    pagination.items === null
      ? section.items
      : section.items.slice(pagination.items[0], pagination.items[1]);
  const emptyMessage = searchActive
    ? "No transactions match this search."
    : section.emptyMessage;

  return (
    <section className={`${section.tone.containerClass} ${className}`.trim()}>
      <div className={`px-5 py-4 ${section.tone.headerClass}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2
              className={`text-lg font-semibold ${section.tone.headerTitleClass}`}
            >
              {section.title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{section.description}</p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <span className={section.tone.countBadgeClass}>
              {section.items.length}
            </span>
            {headerAction}
          </div>
        </div>
      </div>

      {section.items.length === 0 ? (
        <div className="px-5 py-8 text-sm text-slate-500">{emptyMessage}</div>
      ) : (
        <>
          <div className="divide-y divide-slate-200">
            {pagedItems.map((item) => renderTransactionRow(item, showOriginBadge))}
          </div>

          {pagination.showControls ? (
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
              <div className="text-sm text-slate-500">
                Page {pagination.currentPage} of {pagination.totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    onPageChange(section.id, pagination.currentPage - 1)
                  }
                  disabled={pagination.currentPage === 1}
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onPageChange(section.id, pagination.currentPage + 1)
                  }
                  disabled={pagination.currentPage === pagination.totalPages}
                  className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

export default function TransactionOutcomeBoard({
  items,
  showOriginBadge = false,
}: TransactionOutcomeBoardProps) {
  const [showOutgoing, setShowOutgoing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageBySection, setPageBySection] = useState<Record<SectionId, number>>(
    () => ({ ...INITIAL_PAGE_BY_SECTION })
  );

  const pendingItems = items.filter((item) => item.match === null);
  const pendingOutgoingCount = pendingItems.filter(
    (item) => item.transaction.direction === "outgoing"
  ).length;
  const incomingItems = items.filter(
    (item) => item.transaction.direction === "incoming"
  );
  const outgoingItems = items.filter(
    (item) => item.transaction.direction === "outgoing"
  );
  const summarySections = buildIncomingSections(incomingItems);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredIncomingItems = incomingItems.filter((item) =>
    matchesSearch(item, normalizedSearchQuery)
  );
  const filteredOutgoingItems = outgoingItems.filter((item) =>
    matchesSearch(item, normalizedSearchQuery)
  );
  const incomingSections = buildIncomingSections(filteredIncomingItems);
  const hasAnyTransactions = incomingItems.length > 0 || outgoingItems.length > 0;
  const searchActive = normalizedSearchQuery.length > 0;
  const helperText = searchActive
    ? `Showing ${filteredIncomingItems.length} matching incoming transactions${
        showOutgoing
          ? ` and ${filteredOutgoingItems.length} matching outgoing transactions.`
          : "."
      }`
    : "Search across transaction name, amount, date, and transaction ID.";

  function handleSearchChange(nextSearchQuery: string) {
    setSearchQuery(nextSearchQuery);
    setPageBySection({ ...INITIAL_PAGE_BY_SECTION });
  }

  function handlePageChange(sectionId: SectionId, nextPage: number) {
    setPageBySection((current) => ({
      ...current,
      [sectionId]: Math.max(1, nextPage),
    }));
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summarySections.map((section) => (
          <div
            key={section.id}
            className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-sm"
          >
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span
                className={`h-2.5 w-2.5 rounded-full ${section.tone.summaryDotClass}`}
              />
              <span>{section.title}</span>
            </div>
            <div className="mt-3 text-3xl font-semibold text-white">
              {section.items.length}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {section.description}
            </p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
          <div className="space-y-2">
            <label
              htmlFor="transaction-search"
              className="text-sm font-medium text-slate-900"
            >
              Search transactions
            </label>
            <input
              id="transaction-search"
              type="search"
              value={searchQuery}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search transactions by name, amount, date, or transaction ID..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            <p className="text-sm text-slate-500">{helperText}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">
              Outgoing / Ignored
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Stored for completeness, but kept separate from incoming
              reconciliation by default.
            </p>
            <label className="mt-4 inline-flex cursor-pointer items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm">
              <input
                type="checkbox"
                checked={showOutgoing}
                onChange={(event) => setShowOutgoing(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
              />
              <span>
                {showOutgoing
                  ? `Hide ${outgoingItems.length} outgoing transactions`
                  : `Show ${outgoingItems.length} outgoing transactions`}
              </span>
            </label>
          </div>
        </div>
      </section>

      {!hasAnyTransactions ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          No transactions found.
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {incomingSections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              showOriginBadge={showOriginBadge}
              requestedPage={pageBySection[section.id]}
              searchActive={searchActive}
              onPageChange={handlePageChange}
              headerAction={
                section.id === "pending" ? (
                  <ProcessPendingTransactionsButton
                    pendingCount={pendingItems.length}
                    pendingOutgoingCount={pendingOutgoingCount}
                  />
                ) : undefined
              }
            />
          ))}

          {showOutgoing ? (
            <SectionCard
              section={{
                id: "outgoing",
                title: "Outgoing / Ignored",
                description:
                  "Stored for completeness, but not eligible for invoice matching.",
                emptyMessage: "No outgoing transactions found.",
                items: filteredOutgoingItems,
                tone: SECTION_TONES.outgoing,
              }}
              showOriginBadge={showOriginBadge}
              requestedPage={pageBySection.outgoing}
              searchActive={searchActive}
              onPageChange={handlePageChange}
              className="xl:col-span-2"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
