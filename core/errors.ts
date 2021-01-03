export type ClientErrorType = "connect" | "read" | "write" | "close";

export interface ClientError extends Error {
  type: ClientErrorType;
}

export type ErrorArgs = [
  type: ClientErrorType,
  error: Error,
] | [
  type: ClientErrorType,
  error: string,
  callSite: Function,
];

export function toClientError(
  ...[type, error, callSite]: ErrorArgs
): ClientError {
  if (typeof error === "string") {
    error = new Error(error);
    Error.captureStackTrace(error, callSite);
  }

  (error as ClientError).type = type;
  error.message = `${type}: ${error.message}`;

  return error as ClientError;
}
