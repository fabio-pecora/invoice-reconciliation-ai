// High level: Configures the Plaid API client for sandbox, development, or production environments.
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const plaidEnv = process.env.PLAID_ENV || "sandbox";

const basePath =
  plaidEnv === "sandbox"
    ? PlaidEnvironments.sandbox
    : plaidEnv === "development"
    ? PlaidEnvironments.development
    : PlaidEnvironments.production;

const configuration = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID || "",
      "PLAID-SECRET": process.env.PLAID_SECRET || "",
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
