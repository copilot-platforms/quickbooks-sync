import { UPSTASH_REDIS_REST_TOKEN, UPSTASH_REDIS_REST_URL } from '@/config'
import { Redis } from '@upstash/redis'

class RedisClient {
  private static instance: Redis

  private constructor() {}

  public static getInstance(): Redis {
    if (!RedisClient.instance) {
      RedisClient.instance = new Redis({
        url: UPSTASH_REDIS_REST_URL,
        token: UPSTASH_REDIS_REST_TOKEN,
      })
    }
    return RedisClient.instance
  }
}

export default RedisClient
