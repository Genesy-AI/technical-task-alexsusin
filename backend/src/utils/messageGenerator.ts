import { isLeadTemplateFieldKey, LeadTemplateFieldKey } from '@tinyenginy/shared'

// Any lead-shaped object works: only the keys of the shared template field catalog are read.
export type Lead = { firstName: string } & Partial<Record<LeadTemplateFieldKey, string | number | null>>

export function generateMessageFromTemplate(template: string, lead: Lead): string {
  let message = template

  const templateVariables = template.match(/\{(\w+)\}/g) || []

  for (const variable of templateVariables) {
    const fieldName = variable.slice(1, -1)

    if (isLeadTemplateFieldKey(fieldName)) {
      const fieldValue = lead[fieldName]

      if (fieldValue === null || fieldValue === undefined || fieldValue === '') {
        throw new Error(`Missing required field: ${fieldName}`)
      }

      // Replacer function so "$" sequences in values are inserted literally.
      message = message.replace(new RegExp(`\\{${fieldName}\\}`, 'g'), () => String(fieldValue))
    } else {
      throw new Error(`Unknown field in template: ${fieldName}`)
    }
  }

  return message
}
