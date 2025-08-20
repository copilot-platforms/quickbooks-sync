import { WorkspaceResponse } from '@/type/common'

export const getWorkspaceLabel = (workspace: WorkspaceResponse) => {
  return {
    individualTerm: workspace.label?.individualTerm || 'client',
    individualTermPlural: workspace.label?.individualTermPlural || 'clients',
    groupTerm: workspace.label?.groupTerm || 'company',
    groupTermPlural: workspace.label?.groupTermPlural || 'companies',
  }
}
