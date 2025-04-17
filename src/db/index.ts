import { drizzle } from 'drizzle-orm/postgres-js'
import postgres, { Sql } from 'postgres'
import { DATABASE_URL } from '@/config'

class DBClient {
  private static instance: DBClient
  private client: Sql
  public db: ReturnType<typeof drizzle>

  private constructor() {
    this.client = postgres(DATABASE_URL!)
    this.db = drizzle(this.client)
  }

  static getInstance(): DBClient {
    if (!DBClient.instance) {
      DBClient.instance = new DBClient()
    }
    return DBClient.instance
  }

  getDrizzle() {
    return this.db
  }

  getRawClient() {
    return this.client
  }
}

export default DBClient.getInstance()
