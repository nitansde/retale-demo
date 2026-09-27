import type { z } from 'zod'
import { InputValidationError } from '@/lib/server/domain-errors'

/** Use only for client input; model output and stored-data validation are server failures. */
export function parseRequestInput<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const field = issue?.path.join('.') || 'request'
  const message = issue?.message || 'Invalid value'
  throw new InputValidationError(`${field}: ${message}`)
}
