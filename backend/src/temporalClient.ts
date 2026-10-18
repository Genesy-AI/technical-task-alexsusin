import { Client, Connection } from '@temporalio/client'

let clientPromise: Promise<Client> | undefined

// One connection per process, created on first use. A failed connect is not cached, so the next call retries.
export function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({ address: 'localhost:7233' })
      .then((connection) => new Client({ connection, namespace: 'default' }))
      .catch((error) => {
        clientPromise = undefined
        throw error
      })
  }
  return clientPromise
}
