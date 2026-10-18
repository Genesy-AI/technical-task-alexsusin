export type LeadsEnrichPhonesInput = {
  leadIds: number[]
}

export type LeadsEnrichPhonesOutput = {
  success: boolean
  startedCount: number
  errors: Array<{
    leadId: number
    leadName: string
    error: string
  }>
}
