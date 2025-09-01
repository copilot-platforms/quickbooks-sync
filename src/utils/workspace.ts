import { WorkspaceResponse } from '@/type/common'

export const getWorkspaceLabel = (workspace: WorkspaceResponse) => {
  return {
    individualTerm: workspace.labels?.individualTerm?.toLowerCase() || 'client',
    individualTermPlural:
      workspace.labels?.individualTermPlural?.toLowerCase() || 'clients',
    groupTerm: workspace.labels?.groupTerm?.toLowerCase() || 'company',
    groupTermPlural:
      workspace.labels?.groupTermPlural?.toLowerCase() || 'companies',
  }
}
