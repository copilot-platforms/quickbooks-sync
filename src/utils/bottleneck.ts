import Bottleneck from 'bottleneck'

export const bottleneck = new Bottleneck({ maxConcurrent: 4, minTime: 200 })
