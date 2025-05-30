import { getFetcher } from '@/helper/fetch.helper'
import useSWR from 'swr'

const fetcher = (url: string) => getFetcher(url, {})

export const useSwrHelper = (key: any) =>
  useSWR(key, fetcher, {
    revalidateOnFocus: false,
  })
