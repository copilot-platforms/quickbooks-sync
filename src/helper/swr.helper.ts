import { getFetcher } from '@/helper/fetch.helper'
import useSWR, { SWRConfiguration } from 'swr'

const fetcher = (url: string) => getFetcher(url, {})

export const useSwrHelper = (key: any, opts: SWRConfiguration = {}) =>
  useSWR(key, fetcher, {
    revalidateOnFocus: false,
    ...opts,
  })
