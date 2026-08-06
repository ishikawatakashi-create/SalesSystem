import { randomUUID } from "node:crypto";

/**
 * ワーカーID: インスタンス識別子 + 起動時刻。
 * claim / heartbeat / complete / fail の照合に使う。
 */
export function createWorkerId(now: Date = new Date()): string {
  const instance =
    process.env.VERCEL_REGION ||
    process.env.HOSTNAME ||
    process.env.COMPUTERNAME ||
    "local";
  return `${instance}:${now.toISOString()}:${randomUUID().slice(0, 8)}`;
}
