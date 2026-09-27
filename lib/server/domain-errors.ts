/** Expected failures shared by services and HTTP boundaries, without a Next dependency. */
export class DomainError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422, message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

export class InputValidationError extends DomainError {
  constructor(message: string) {
    super(400, message)
    this.name = 'InputValidationError'
  }
}

export class ResourceNotFoundError extends DomainError {
  constructor(message: string) {
    super(404, message)
    this.name = 'ResourceNotFoundError'
  }
}
