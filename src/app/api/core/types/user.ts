/**
 * UserAction holds every permitted action that a user is allowed to perform on a given `Resource`
 */
export enum UserAction {
  ALL = 'all',
  READ = 'read',
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

/**
 * User roles as defined by Copilot
 */
export enum UserRole {
  CLIENT = 'client',
  IU = 'internalUser',
}
