import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { Sql } from 'postgres'
import { databaseUrl } from '@/config'
import { schema } from '@/db/schema'
import { relation } from '@/db/schema/relation'

class DBClient {
  private static instance: DBClient
  private client: Sql
  public db: PostgresJsDatabase<typeof schema & typeof relation>

  private constructor() {
    this.client = postgres(databaseUrl!, { prepare: false })
    this.db = drizzle(this.client, {
      schema: { ...schema, ...relation },
      casing: 'snake_case',
    })
  }

  static getInstance(): DBClient {
    if (!DBClient.instance) {
      DBClient.instance = new DBClient()
    }
    return DBClient.instance
  }

  getDB(): PostgresJsDatabase<typeof schema & typeof relation> {
    return this.db
  }

  getRawClient() {
    return this.client
  }
}

export const db = DBClient.getInstance().getDB()
export const client = DBClient.getInstance().getRawClient()
