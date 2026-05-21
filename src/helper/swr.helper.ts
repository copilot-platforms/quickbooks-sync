import { getFetcher } from '@/helper/fetch.helper'
import useSWR, { SWRConfiguration } from 'swr'

// In-app SWR fetches against this app's own routes — no client-side timeout.
// SWR handles its own error-retry; aborts here would just produce false negatives.
const fetcher = (url: string) => getFetcher(url, {}, { timeoutMs: null })

export const useSwrHelper = <T = any>(
  key: any,
  opts: SWRConfiguration<T> = {},
) =>
  useSWR<T>(key, fetcher, {
    revalidateOnFocus: false,
    suspense: true,
    revalidateOnMount: false,
    ...opts,
  })
