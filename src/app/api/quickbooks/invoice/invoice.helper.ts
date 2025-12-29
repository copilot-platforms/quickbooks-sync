import { ClientStatus } from '@/app/api/core/types/client'
import { ClientResponse } from '@/type/common'

export function getLatestActiveClient(clients: ClientResponse[]) {
  const filteredClients = clients.filter((client) => {
    return client.status === ClientStatus.ACTIVE
  })

  // check if there are any active clients. If not, return the first client
  if (!filteredClients.length) return clients[0]

  const sortedClients = sortClientsByDate(filteredClients)
  return sortedClients[0]
}

function sortClientsByDate(
  users: ClientResponse[],
  order: 'asc' | 'desc' = 'asc',
): ClientResponse[] {
  return [...users].sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return order === 'asc' ? dateA - dateB : dateB - dateA
  })
}
