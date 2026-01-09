import CronService from '@/app/api/quickbooks/cron/cron.service'
import { task } from '@trigger.dev/sdk'

export const processResyncForFailedRecords = task({
  id: 'process-resync-for-failed-records',
  machine: 'small-2x',
  run: async () => {
    console.log(
      'resyncFailedRecords#processResyncForFailedRecords :: Trigger resync task',
    )
    const cronService = new CronService()
    await cronService.rerunFailedSync()
  },
})
