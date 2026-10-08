/**
 * 可审计的同步压力基线。
 *
 * 这些数字是测试契约中的规划假设，不是对用户行为的统计结论：
 * 普通日常负载按一天内 200 次同步活动、20 次按需原文获取，以及
 * 一次 8 MiB 的大对象快照计算。压力测试固定放大 10 倍，便于在本地
 * 比较不同实现的结果，而不会随着测试作者的主观感觉漂移。
 */
export const SYNC_STRESS_FACTOR = 10;

export const DAILY_SYNC_LOAD = Object.freeze({
  publishedItems: 200,
  incomingChanges: 200,
  onDemandWork: 20,
  progressUpdates: 10_000,
  largeObjectBytes: 8 * 1024 * 1024,
});

export const STRESS_SYNC_LOAD = Object.freeze({
  publishedItems: DAILY_SYNC_LOAD.publishedItems * SYNC_STRESS_FACTOR,
  incomingChanges: DAILY_SYNC_LOAD.incomingChanges * SYNC_STRESS_FACTOR,
  onDemandWork: DAILY_SYNC_LOAD.onDemandWork * SYNC_STRESS_FACTOR,
  progressUpdates: DAILY_SYNC_LOAD.progressUpdates * SYNC_STRESS_FACTOR,
  largeObjectBytes: DAILY_SYNC_LOAD.largeObjectBytes * SYNC_STRESS_FACTOR,
});

for (const [name, value] of Object.entries(STRESS_SYNC_LOAD)) {
  if (value !== DAILY_SYNC_LOAD[name] * SYNC_STRESS_FACTOR)
    throw new Error(`Invalid synchronization stress profile value: ${name}`);
}
