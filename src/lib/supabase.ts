import { supabaseAnonKey, supabaseProjectUrl } from '@/config'
import {
  createClient,
  SupabaseClient as SupabaseJsClient,
} from '@supabase/supabase-js'

class SupabaseClient {
  private static instance: SupabaseJsClient

  private constructor() {}

  public static getInstance(): SupabaseJsClient {
    if (!SupabaseClient.instance) {
      SupabaseClient.instance = createClient(
        supabaseProjectUrl,
        supabaseAnonKey,
      )
    }
    return SupabaseClient.instance
  }
}

export default SupabaseClient
