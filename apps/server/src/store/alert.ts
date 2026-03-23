// 持久化写入失败告警：可选 webhook 通知，未配置 ALERT_WEBHOOK_URL 时零侵入。
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;
let lastAlertAt = 0;

/** 供测试重置冷却计时器 */
export function resetAlertCooldownForTest() {
  lastAlertAt = 0;
}

export function notifyWriteFailure(label: string, error: unknown): void {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  const now = Date.now();
  if (now - lastAlertAt < ALERT_COOLDOWN_MS) return;
  lastAlertAt = now;

  const message = `[AssistFlow] 持久化写入失败：${label} — ${(error as any)?.message || error}`;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
  }).catch(() => {});
}
