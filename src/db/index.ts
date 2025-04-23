import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { Sql } from 'postgres'
import { databaseUrl } from '@/config'
import { schema } from '@/db/schema'

class DBClient {
  private static instance: DBClient
  private client: Sql
  public db: PostgresJsDatabase<typeof schema>

  private constructor() {
    this.client = postgres(databaseUrl!)
    this.db = drizzle(this.client, {
      schema: { ...schema },
      casing: 'snake_case',
    })
  }

  static getInstance(): DBClient {
    if (!DBClient.instance) {
      DBClient.instance = new DBClient()
    }
    return DBClient.instance
  }

  getDrizzle(): PostgresJsDatabase<typeof schema> {
    return this.db
  }

  getRawClient() {
    return this.client
  }
}

export const db = DBClient.getInstance().getDrizzle()
export const client = DBClient.getInstance().getRawClient()
