import { FC } from 'react'
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-react'
import { PhoneEnrichmentStatus } from '@tinyenginy/shared'

interface PhoneEnrichmentCellProps {
  phoneNumber: string | null
  status: PhoneEnrichmentStatus | null
  provider: string | null
}

/** Phone number plus the live state of its enrichment (queued, searching a provider, result). */
export const PhoneEnrichmentCell: FC<PhoneEnrichmentCellProps> = ({ phoneNumber, status, provider }) => {
  if (status === 'pending' || status === 'running') {
    return (
      <div className="flex items-center gap-1.5 text-sm text-blue-700">
        <IconLoader2 size={14} className="animate-spin" aria-hidden="true" />
        <span>{status === 'running' && provider ? `Searching ${provider}...` : 'Queued...'}</span>
      </div>
    )
  }

  return (
    <div>
      {phoneNumber ? (
        <div className="text-sm text-gray-900">{phoneNumber}</div>
      ) : (
        status !== 'not_found' && <div className="text-sm text-gray-900">-</div>
      )}
      {status === 'found' && provider && <div className="text-xs text-gray-500">via {provider}</div>}
      {status === 'not_found' && <div className="text-xs italic text-gray-500">No data found</div>}
      {status === 'failed' && (
        <div
          className="flex items-center gap-1 text-xs text-red-600"
          title="Some providers failed; try again later"
        >
          <IconAlertTriangle size={12} aria-hidden="true" />
          Lookup failed
        </div>
      )}
    </div>
  )
}
