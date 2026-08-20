import User from '@/app/api/core/models/User.model'
import { client, db } from '@/db'
import { schema } from '@/db/schema'
import { relation } from '@/db/schema/relation'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Sql } from 'postgres'

/**
 * Base Service with access to db and current user
 */
export class BaseService {
  protected db: PostgresJsDatabase<typeof schema & typeof relation> = db
  protected client: Sql = client
  public user: User

  constructor(user: User) {
    this.user = user
  }

  setTransaction(tx: PostgresJsDatabase<typeof schema & typeof relation>) {
    this.db = tx
  }

  unsetTransaction() {
    this.db = db
  }

  /**
   * Runs `fn` in a transaction with this service (and any passed `services`)
   * bound to the tx, restored in a `finally` that wraps the transaction so none
   * is left on a closed handle.
   */
  protected async withTransaction<T>(
    fn: (tx: PostgresJsDatabase<typeof schema & typeof relation>) => Promise<T>,
    services: BaseService[] = [],
  ): Promise<T> {
    const bound = [this, ...services]
    try {
      return await this.db.transaction(async (tx) => {
        bound.forEach((service) => service.setTransaction(tx))
        return await fn(tx)
      })
    } finally {
      bound.forEach((service) => service.unsetTransaction())
    }
  }
}
