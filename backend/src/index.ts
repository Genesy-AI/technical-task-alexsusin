import express, { Request, Response } from 'express'
import { WorkflowFailedError } from '@temporalio/client'
import { enrichPhoneWorkflow, verifyEmailWorkflow } from './workflows'
import { getTemporalClient } from './temporalClient'
import { generateMessageFromTemplate } from './utils/messageGenerator'
import { parseOptionalLeadFields } from './utils/leadFields'
import { runTemporalWorker } from './worker'
import { prisma } from './db'
import { getAppSettings } from './config/appSettings'
import { buildPhoneEnrichmentPlan } from './phoneEnrichment/plan'

// Fail fast on invalid settings (missing provider secrets, typos in templates...) before serving requests.
getAppSettings()

const app = express()
app.use(express.json())

app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.sendStatus(200)
    return
  }

  next()
})

app.post('/leads', async (req: Request, res: Response) => {
  const { name, lastName, email } = req.body

  if (!name || !lastName || !email) {
    return res.status(400).json({ error: 'firstName, lastName, and email are required' })
  }

  const lead = await prisma.lead.create({
    data: {
      firstName: String(name),
      lastName: String(lastName),
      email: String(email),
    },
  })
  res.json(lead)
})

app.get('/leads/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  const lead = await prisma.lead.findUnique({
    where: {
      id: Number(id),
    },
  })
  res.json(lead)
})

app.get('/leads', async (req: Request, res: Response) => {
  const leads = await prisma.lead.findMany()

  res.json(leads)
})

app.patch('/leads/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  const { name, email } = req.body
  const lead = await prisma.lead.update({
    where: {
      id: Number(id),
    },
    data: {
      firstName: String(name),
      email: String(email),
    },
  })
  res.json(lead)
})

app.delete('/leads/:id', async (req: Request, res: Response) => {
  const { id } = req.params
  await prisma.lead.delete({
    where: {
      id: Number(id),
    },
  })
  res.json()
})

app.delete('/leads', async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is required and must be valid JSON' })
  }

  const { ids } = req.body

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' })
  }

  try {
    const result = await prisma.lead.deleteMany({
      where: {
        id: {
          in: ids.map((id) => Number(id)),
        },
      },
    })

    res.json({ deletedCount: result.count })
  } catch (error) {
    console.error('Error deleting leads:', error)
    res.status(500).json({ error: 'Failed to delete leads' })
  }
})

app.post('/leads/generate-messages', async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is required and must be valid JSON' })
  }

  const { leadIds, template } = req.body

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'leadIds must be a non-empty array' })
  }

  if (!template || typeof template !== 'string') {
    return res.status(400).json({ error: 'template must be a non-empty string' })
  }

  try {
    const leads = await prisma.lead.findMany({
      where: {
        id: {
          in: leadIds.map((id) => Number(id)),
        },
      },
    })

    if (leads.length === 0) {
      return res.status(404).json({ error: 'No leads found with the provided IDs' })
    }

    let generatedCount = 0
    const errors: Array<{ leadId: number; leadName: string; error: string }> = []

    for (const lead of leads) {
      try {
        const message = generateMessageFromTemplate(template, lead)

        await prisma.lead.update({
          where: { id: lead.id },
          data: { message },
        })

        generatedCount++
      } catch (error) {
        errors.push({
          leadId: lead.id,
          leadName: `${lead.firstName} ${lead.lastName}`.trim(),
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    res.json({
      success: true,
      generatedCount,
      errors,
    })
  } catch (error) {
    console.error('Error generating messages:', error)
    res.status(500).json({ error: 'Failed to generate messages' })
  }
})

app.post('/leads/bulk', async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is required and must be valid JSON' })
  }

  const { leads } = req.body

  if (!Array.isArray(leads) || leads.length === 0) {
    return res.status(400).json({ error: 'leads must be a non-empty array' })
  }

  try {
    const validLeads = leads.filter((lead) => {
      return (
        lead.firstName &&
        lead.lastName &&
        lead.email &&
        typeof lead.firstName === 'string' &&
        lead.firstName.trim() &&
        typeof lead.lastName === 'string' &&
        lead.lastName.trim() &&
        typeof lead.email === 'string' &&
        lead.email.trim()
      )
    })

    if (validLeads.length === 0) {
      return res
        .status(400)
        .json({ error: 'No valid leads found. firstName, lastName, and email are required.' })
    }

    const errors: Array<{ lead: any; error: string }> = []
    const acceptedLeads: typeof validLeads = []

    for (const lead of validLeads) {
      const optionalFields = parseOptionalLeadFields(lead)
      if (!optionalFields.ok) {
        errors.push({ lead, error: optionalFields.errors.join('; ') })
        continue
      }
      acceptedLeads.push({ ...lead, ...optionalFields.value })
    }

    const existingLeads = await prisma.lead.findMany({
      where: {
        OR: acceptedLeads.map((lead) => ({
          AND: [{ firstName: lead.firstName.trim() }, { lastName: lead.lastName.trim() }],
        })),
      },
    })

    const leadKeys = new Set(
      existingLeads.map((lead) => `${lead.firstName.toLowerCase()}_${(lead.lastName || '').toLowerCase()}`)
    )

    const uniqueLeads = acceptedLeads.filter((lead) => {
      const key = `${lead.firstName.toLowerCase()}_${lead.lastName.toLowerCase()}`
      return !leadKeys.has(key)
    })

    let importedCount = 0

    for (const lead of uniqueLeads) {
      try {
        await prisma.lead.create({
          data: {
            firstName: lead.firstName.trim(),
            lastName: lead.lastName.trim(),
            email: lead.email.trim(),
            jobTitle: lead.jobTitle ? lead.jobTitle.trim() : null,
            countryCode: lead.countryCode,
            companyName: lead.companyName ? lead.companyName.trim() : null,
            phoneNumber: lead.phoneNumber,
            yearsAtCompany: lead.yearsAtCompany,
            linkedinUrl: lead.linkedinUrl,
          },
        })
        importedCount++
      } catch (error) {
        errors.push({
          lead: lead,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    res.json({
      success: true,
      importedCount,
      duplicatesSkipped: acceptedLeads.length - uniqueLeads.length,
      invalidLeads: leads.length - validLeads.length,
      errors,
    })
  } catch (error) {
    console.error('Error importing leads:', error)
    res.status(500).json({ error: 'Failed to import leads' })
  }
})

app.post('/leads/verify-emails', async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is required and must be valid JSON' })
  }

  const { leadIds } = req.body as { leadIds?: number[] }

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'leadIds must be a non-empty array' })
  }

  try {
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds.map((id) => Number(id)) } },
    })

    if (leads.length === 0) {
      return res.status(404).json({ error: 'No leads found with the provided IDs' })
    }

    const client = await getTemporalClient()

    // One workflow per lead: the ID is deterministic, so a repeated request while a verification is running
    // attaches to the existing execution instead of starting a new one. Once it has finished, a new request
    // starts a fresh verification (default reuse policy). Leads are verified in parallel so a slow one does
    // not hold back the rest, and the bounded retry policy guarantees every workflow ends.
    const outcomes = await Promise.allSettled(
      leads.map(async (lead) => {
        const isVerified = await client.workflow.execute(verifyEmailWorkflow, {
          taskQueue: 'myQueue',
          workflowId: `verify-email-${lead.id}`,
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowExecutionTimeout: '1 minute',
          args: [lead.email],
        })

        await prisma.lead.update({
          where: { id: lead.id },
          data: { emailVerified: isVerified },
        })

        return isVerified
      })
    )

    const results: Array<{ leadId: number; emailVerified: boolean }> = []
    const errors: Array<{ leadId: number; leadName: string; error: string }> = []

    outcomes.forEach((outcome, index) => {
      const lead = leads[index]
      if (outcome.status === 'fulfilled') {
        results.push({ leadId: lead.id, emailVerified: outcome.value })
        return
      }

      console.error(`Error verifying email for lead ${lead.id}:`, outcome.reason)
      errors.push({
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`.trim(),
        error:
          outcome.reason instanceof WorkflowFailedError
            ? 'The email verification provider did not respond after several attempts'
            : 'Unexpected error while verifying the email',
      })
    })

    res.json({ success: true, verifiedCount: results.length, results, errors })
  } catch (error) {
    console.error('Error verifying emails:', error)
    res.status(500).json({ error: 'Failed to verify emails' })
  }
})

app.post('/leads/enrich-phone', async (req: Request, res: Response) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Request body is required and must be valid JSON' })
  }

  const { leadIds } = req.body as { leadIds?: number[] }

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return res.status(400).json({ error: 'leadIds must be a non-empty array' })
  }

  try {
    const settings = getAppSettings().phoneEnrichment
    // Resolved now and passed to the workflow, so later config edits do not change running enrichments.
    const plan = buildPhoneEnrichmentPlan(settings)
    if (plan.steps.length === 0) {
      return res.status(503).json({ error: 'No phone providers are enabled' })
    }

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds.map((id) => Number(id)) } },
    })

    if (leads.length === 0) {
      return res.status(404).json({ error: 'No leads found with the provided IDs' })
    }

    const client = await getTemporalClient()

    // Fire and forget: the workflows report progress on the lead (phoneEnrichmentStatus) and the UI polls it.
    // One workflow per lead: a request for a lead that is already being enriched attaches to that execution.
    const outcomes = await Promise.allSettled(
      leads.map(async (lead) => {
        await client.workflow.start(enrichPhoneWorkflow, {
          taskQueue: 'myQueue',
          workflowId: `enrich-phone-${lead.id}`,
          workflowIdConflictPolicy: 'USE_EXISTING',
          workflowExecutionTimeout: settings.workflowTimeoutMs,
          args: [{ leadId: lead.id, plan }],
        })

        // Marked after starting so a status the workflow already wrote ("running") is not overwritten.
        await prisma.lead.updateMany({
          where: {
            id: lead.id,
            OR: [
              { phoneEnrichmentStatus: null },
              { phoneEnrichmentStatus: { notIn: ['pending', 'running'] } },
            ],
          },
          data: { phoneEnrichmentStatus: 'pending', phoneEnrichmentProvider: null },
        })
      })
    )

    const errors: Array<{ leadId: number; leadName: string; error: string }> = []
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') return
      const lead = leads[index]
      console.error(`Error starting phone enrichment for lead ${lead.id}:`, outcome.reason)
      errors.push({
        leadId: lead.id,
        leadName: `${lead.firstName} ${lead.lastName}`.trim(),
        error: 'Could not start the phone enrichment',
      })
    })

    res.json({ success: true, startedCount: leads.length - errors.length, errors })
  } catch (error) {
    console.error('Error enriching phones:', error)
    res.status(500).json({ error: 'Failed to enrich phones' })
  }
})

app.listen(4000, () => {
  console.log('Express server is running on port 4000')
})

runTemporalWorker().catch((err) => {
  console.error(err)
  process.exit(1)
})
