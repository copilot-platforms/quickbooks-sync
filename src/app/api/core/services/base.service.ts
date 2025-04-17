import User from '@/app/api/core/models/User.model'
import { client, db } from '@/db'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Sql } from 'postgres'

/**
 * Base Service with access to db and current user
 */
export class BaseService {
  protected db: PostgresJsDatabase = db
  protected client: Sql = client
  public user: User

  constructor(user: User) {
    this.user = user
  }
}
