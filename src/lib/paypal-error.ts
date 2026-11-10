export class PayPalError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public debugId?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}
