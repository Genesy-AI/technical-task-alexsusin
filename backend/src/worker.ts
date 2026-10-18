import { NativeConnection, Worker } from '@temporalio/worker'
import { getAppSettings } from './config/appSettings'
import { buildPhoneEnrichmentPlan } from './phoneEnrichment/plan'
import * as activities from './workflows/activities'

export async function runTemporalWorker() {
  const connection = await NativeConnection.connect({
    address: 'localhost:7233',
  })
  try {
    const { phoneEnrichment } = getAppSettings()

    const mainWorker = await Worker.create({
      connection,
      namespace: 'default',
      taskQueue: 'myQueue',
      workflowsPath: require.resolve('./workflows'),
      activities,
    })

    // One activity-only worker per enabled phone provider. Temporal enforces maxTaskQueueActivitiesPerSecond
    // across every worker of the queue, so the provider's rate limit holds even with several API instances.
    const providerWorkers = await Promise.all(
      buildPhoneEnrichmentPlan(phoneEnrichment).steps.map((step) =>
        Worker.create({
          connection,
          namespace: 'default',
          taskQueue: step.taskQueue,
          activities: { callPhoneProvider: activities.callPhoneProvider },
          maxTaskQueueActivitiesPerSecond:
            phoneEnrichment.providers[step.providerId].rateLimit?.maxRequestsPerSecond,
        })
      )
    )

    await Promise.all([mainWorker, ...providerWorkers].map((worker) => worker.run()))
  } finally {
    await connection.close()
  }
}
