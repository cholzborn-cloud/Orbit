import { isExpired } from "./expiry.ts"

export type ApprovalRequestStore = {
  create: (request: {
    toolCallId: string
    userId: string
    tool: string
    automationRunId?: string
  }) => Promise<number | Date>
  get: (toolCallId: string, userId: string) => Promise<number | Date | null>
}

export function approvalNeedsApproval(
  store: ApprovalRequestStore,
  input: {
    required: boolean
    toolCallId: string
    userId: string
    tool: string
    automationRunId?: string
  }
) {
  return async () => {
    if (!input.required) return false
    await store.create(input)
    return true
  }
}

export async function approvalExecute<T>(
  store: ApprovalRequestStore,
  toolCallId: string,
  userId: string,
  required: boolean,
  now: number,
  run: () => Promise<T>
): Promise<T | { error: string }> {
  if (!required) return run()
  const requestedAt = await store.get(toolCallId, userId)
  if (requestedAt === null || isExpired(requestedAt, now))
    return { error: "approval expired" }
  return run()
}
