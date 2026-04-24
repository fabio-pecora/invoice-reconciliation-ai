"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useRef,
  useState,
} from "react";

type ImportResponse = {
  success?: boolean;
  imported_count?: number;
  updated_count?: number;
  failed_count?: number;
  errors?: string[];
};

type FeedbackState =
  | {
      tone: "success" | "error";
      message: string;
      details?: string[];
    }
  | {
      tone: null;
      message: null;
      details?: never;
    };

const EXPECTED_COLUMNS = [
  "invoice_number",
  "customer_name",
  "invoice_date",
  "due_date",
  "amount or line items",
] as const;

export default function InvoiceImportForm() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>({
    tone: null,
    message: null,
  });

  function selectFile(file: File | null) {
    setSelectedFile(file);
    setFeedback({ tone: null, message: null });
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0] ?? null);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0] ?? null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isImporting) {
      return;
    }

    if (!selectedFile) {
      setFeedback({
        tone: "error",
        message: "Select a CSV file before importing.",
      });
      return;
    }

    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      setFeedback({
        tone: "error",
        message: "Only CSV files can be imported.",
      });
      return;
    }

    setIsImporting(true);
    setFeedback({ tone: null, message: null });

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch("/api/invoices/import", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as ImportResponse;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.errors?.join(" ") ?? "Failed to import invoices."
        );
      }

      setSelectedFile(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      setFeedback({
        tone: "success",
        message: `Imported ${payload.imported_count ?? 0} invoice${
          payload.imported_count === 1 ? "" : "s"
        }. Updated ${payload.updated_count ?? 0}.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to import invoices.";

      setFeedback({
        tone: "error",
        message,
      });
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-500">
              Invoice intake
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">
              Import Invoices
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-slate-600">
            Upload a CSV file to add or update invoices in the system.
          </p>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-medium text-slate-900">
              Expected CSV columns
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXPECTED_COLUMNS.map((column) => (
                <span
                  key={column}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
                >
                  {column}
                </span>
              ))}
            </div>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-8 text-center transition ${
              isDragging
                ? "border-blue-400 bg-blue-50"
                : "border-slate-300 bg-slate-50 hover:border-slate-400"
            }`}
          >
            <span className="text-sm font-medium text-slate-900">
              {selectedFile ? selectedFile.name : "Choose or drop a CSV file"}
            </span>
            <span className="mt-1 text-sm text-slate-500">
              CSV files only
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleInputChange}
              disabled={isImporting}
              className="sr-only"
            />
          </label>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={isImporting || !selectedFile}
              aria-busy={isImporting}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isImporting ? "Importing..." : "Import CSV"}
            </button>
            <Link
              href="/invoices"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              View Invoices
            </Link>
          </div>

          {feedback.message ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                feedback.tone === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-red-200 bg-red-50 text-red-900"
              }`}
            >
              <div>{feedback.message}</div>
              {feedback.tone === "success" ? (
                <div className="mt-1">
                  Review imported records in{" "}
                  <Link
                    href="/invoices"
                    className="font-medium text-emerald-900 underline"
                  >
                    Invoices
                  </Link>
                  .
                </div>
              ) : null}
            </div>
          ) : null}
        </form>
      </div>
    </section>
  );
}
