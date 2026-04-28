// High level: Redirects the legacy transactions route to the reconciliation workspace.
import { redirect } from "next/navigation";

export default function TransactionsPage() {
  redirect("/reconciliation");
}
