import Bottleneck from 'bottleneck'

export const bottleneck = new Bottleneck({ maxConcurrent: 3, minTime: 250 })
