import { proxyActivities } from '@temporalio/workflow'
import type * as activities from './activities'

// Bounded retries so a slow or failing provider ends in a workflow failure instead of retrying forever.
// Worst case: 3 attempts x 3s + 0.5s + 1s of backoff ≈ 10.5s.
const { verifyEmail } = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
  },
})

export async function verifyEmailWorkflow(email: string): Promise<boolean> {
  return await verifyEmail(email)
}
