import { FC, Fragment, ReactNode, useEffect, useState } from 'react'
import {
  IconBrandLinkedin,
  IconBriefcase,
  IconBuilding,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconPhone,
  IconWorld,
} from '@tabler/icons-react'
import { getCountryName, isValidCountryCode } from '@tinyenginy/shared'
import { CsvLead, CsvLeadField } from '../utils/csvParser'

// Optional fields are summarized as chips in each row; new optional fields only need an entry here.
const OPTIONAL_FIELDS = [
  { key: 'jobTitle', label: 'Job title', Icon: IconBriefcase },
  { key: 'companyName', label: 'Company', Icon: IconBuilding },
  { key: 'countryCode', label: 'Country', Icon: IconWorld },
  { key: 'phoneNumber', label: 'Phone', Icon: IconPhone },
  { key: 'yearsAtCompany', label: 'Years at company', Icon: IconClock },
  { key: 'linkedinUrl', label: 'LinkedIn', Icon: IconBrandLinkedin },
] as const satisfies ReadonlyArray<{ key: CsvLeadField; label: string; Icon: TablerIcon }>

const DETAIL_FIELDS: ReadonlyArray<{ key: CsvLeadField; label: string }> = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'email', label: 'Email' },
  ...OPTIONAL_FIELDS,
]

const CHIP_STYLES = {
  filled: 'bg-blue-50 text-blue-700 border-blue-100',
  invalid: 'bg-red-50 text-red-700 border-red-200',
  empty: 'bg-white text-gray-400 border-dashed border-gray-300',
} as const

const formatValue = (field: CsvLeadField, value: string, isInvalid: boolean): ReactNode => {
  if (isInvalid) return value
  if (field === 'countryCode' && isValidCountryCode(value)) return `${value} · ${getCountryName(value)}`
  if (field === 'linkedinUrl') {
    return (
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:underline break-all"
      >
        {value}
      </a>
    )
  }
  return value
}

interface CsvPreviewTableProps {
  leads: CsvLead[]
}

export const CsvPreviewTable: FC<CsvPreviewTableProps> = ({ leads }) => {
  // Invalid rows start expanded so their errors are visible without extra clicks.
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  useEffect(() => {
    setExpandedRows(new Set(leads.filter((lead) => !lead.isValid).map((lead) => lead.rowIndex)))
  }, [leads])

  const toggleRow = (rowIndex: number) => {
    setExpandedRows((previous) => {
      const next = new Set(previous)
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
  }

  const allExpanded = leads.length > 0 && expandedRows.size === leads.length
  const toggleAll = () =>
    setExpandedRows(allExpanded ? new Set() : new Set(leads.map((lead) => lead.rowIndex)))

  const coverage = OPTIONAL_FIELDS.map((field) => ({
    ...field,
    filled: leads.filter((lead) => lead[field.key]).length,
  }))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
          <span>Optional columns:</span>
          {coverage.map(({ key, label, filled }) => (
            <span
              key={key}
              className={`px-2 py-0.5 rounded border ${filled > 0 ? CHIP_STYLES.filled : CHIP_STYLES.empty}`}
              title={
                filled > 0 ? `${filled} of ${leads.length} rows have a ${label.toLowerCase()}` : 'Not in file'
              }
            >
              {label} {filled}/{leads.length}
            </span>
          ))}
        </div>
        <button type="button" onClick={toggleAll} className="text-xs text-blue-600 hover:text-blue-500">
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      <div className="border border-gray-200 rounded-lg max-h-96 overflow-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              <th className="w-8 px-2 py-2" aria-label="Expand row" />
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Row</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lead</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Optional fields
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {leads.map((lead) => {
              const isExpanded = expandedRows.has(lead.rowIndex)
              const fullName = `${lead.firstName} ${lead.lastName}`.trim()

              return (
                <Fragment key={lead.rowIndex}>
                  <tr
                    onClick={() => toggleRow(lead.rowIndex)}
                    className={`cursor-pointer ${lead.isValid ? 'hover:bg-gray-50' : 'bg-red-50 hover:bg-red-100/60'}`}
                  >
                    <td className="px-2 py-2 align-top">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleRow(lead.rowIndex)
                        }}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Hide' : 'Show'} details for row ${lead.rowIndex - 1}`}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-900 align-top">{lead.rowIndex - 1}</td>
                    <td className="px-3 py-2 align-top">
                      {lead.isValid ? (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold text-green-800 bg-green-100 rounded-full">
                          Valid
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-1 text-xs font-semibold text-red-800 bg-red-100 rounded-full">
                          Invalid
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className={`text-sm ${fullName ? 'text-gray-900' : 'text-red-600'}`}>
                        {fullName || 'No name'}
                      </div>
                      <div className={`text-xs ${lead.fieldErrors.email ? 'text-red-600' : 'text-gray-500'}`}>
                        {lead.email || 'No email'}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1">
                        {OPTIONAL_FIELDS.map(({ key, label, Icon }) => {
                          const value = lead[key]
                          const error = lead.fieldErrors[key]
                          const state = error ? 'invalid' : value ? 'filled' : 'empty'
                          return (
                            <span
                              key={key}
                              title={error ?? (value ? `${label}: ${value}` : `${label}: empty`)}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded border ${CHIP_STYLES[state]}`}
                            >
                              <Icon size={12} aria-hidden="true" />
                              {label}
                            </span>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-gray-50">
                      <td />
                      <td colSpan={4} className="px-3 py-3">
                        <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                          {DETAIL_FIELDS.map(({ key, label }) => {
                            const value = lead[key]
                            const error = lead.fieldErrors[key]
                            return (
                              <Fragment key={key}>
                                <dt className="text-gray-500">{label}</dt>
                                <dd className={error ? 'text-red-600' : 'text-gray-900'}>
                                  {value ? (
                                    formatValue(key, value, Boolean(error))
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                  {error && <div className="text-xs">{error}</div>}
                                </dd>
                              </Fragment>
                            )
                          })}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
