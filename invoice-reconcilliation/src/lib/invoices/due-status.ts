export type InvoiceDueStatus =
  | "paid"
  | "current"
  | "almost_due"
  | "overdue"
  | "no_due_date";

type InvoiceDueStatusDisplay = {
  id: InvoiceDueStatus;
  label: string;
  className: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function getTodayUtcDate(today: Date): Date {
  return new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  );
}

export function formatInvoiceDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = parseDateOnly(value);
  return parsed ? dateFormatter.format(parsed) : value;
}

export function getInvoiceDueStatus(input: {
  dueDate: string | null;
  invoiceStatus: string;
  today?: Date;
}): InvoiceDueStatusDisplay {
  if (input.invoiceStatus === "paid") {
    return {
      id: "paid",
      label: "Paid",
      className: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
    };
  }

  if (!input.dueDate) {
    return {
      id: "no_due_date",
      label: "No Due Date",
      className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    };
  }

  const dueDate = parseDateOnly(input.dueDate);

  if (!dueDate) {
    return {
      id: "no_due_date",
      label: "No Due Date",
      className: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
    };
  }

  const today = getTodayUtcDate(input.today ?? new Date());
  const daysUntilDue = Math.floor((dueDate.getTime() - today.getTime()) / MS_PER_DAY);

  if (daysUntilDue < 0) {
    return {
      id: "overdue",
      label: "Overdue",
      className: "bg-red-100 text-red-800 ring-1 ring-red-200",
    };
  }

  if (daysUntilDue <= 7) {
    return {
      id: "almost_due",
      label: "Almost Due",
      className: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
    };
  }

  return {
    id: "current",
    label: "Current",
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  };
}
