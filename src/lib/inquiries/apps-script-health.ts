/** Apps Script heartbeat の健全性（純関数） */
export function heartbeatHealth(
  lastHeartbeatAt: string | null | undefined,
  now = Date.now(),
): "ok" | "delayed" | "unknown" {
  if (!lastHeartbeatAt) return "unknown";
  const t = new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(t)) return "unknown";
  // 5分 poll + 余裕。30分超で遅延扱い
  if (now - t > 30 * 60 * 1000) return "delayed";
  return "ok";
}
