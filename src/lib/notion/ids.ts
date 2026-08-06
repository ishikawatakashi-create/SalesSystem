import { createHash, randomUUID } from "node:crypto";

/** SalesSystem用UUID v5名前空間(固定。決定的external_id生成に使用) */
export const SALES_SYSTEM_NAMESPACE =
  "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

/**
 * UUID v5(決定的)。再実行でも同じ入力から同じUUIDを得る。
 */
export function uuidV5(name: string, namespace = SALES_SYSTEM_NAMESPACE): string {
  const ns = uuidToBytes(namespace);
  const hash = createHash("sha1")
    .update(Buffer.concat([ns, Buffer.from(name, "utf8")]))
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return bytesToUuid(hash.subarray(0, 16));
}

export function newRequestId(): string {
  return randomUUID();
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  return Buffer.from(hex, "hex");
}

function bytesToUuid(buf: Buffer): string {
  const h = buf.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
