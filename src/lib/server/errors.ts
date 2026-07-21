/** Shared error type for the trusted server layer (src/lib/server/**). */
export class ServiceError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}
