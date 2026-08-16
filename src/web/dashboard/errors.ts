export class DashboardServiceError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503 | 504,
    message: string,
  ) {
    super(message);
    this.name = "DashboardServiceError";
  }
}
