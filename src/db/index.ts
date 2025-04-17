import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { Sql } from 'postgres'
import { DATABASE_URL } from '@/config'

class DBClient {
  private static instance: DBClient
  private client: Sql
  public db: PostgresJsDatabase

  private constructor() {
    this.client = postgres(DATABASE_URL!)
    this.db = drizzle(this.client, { casing: 'snake_case' })
  }

  static getInstance(): DBClient {
    if (!DBClient.instance) {
      DBClient.instance = new DBClient()
    }
    return DBClient.instance
  }

  getDrizzle(): PostgresJsDatabase {
    return this.db
  }

  getRawClient() {
    return this.client
  }
}

export const db = DBClient.getInstance().getDrizzle()
export const client = DBClient.getInstance().getRawClient()
