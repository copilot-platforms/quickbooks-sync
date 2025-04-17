import { client } from '@/db'

export class healthCheckService {
  async getApiHealthCheck() {
    await client`SELECT 1`
    return true
  }
}
