import { uuidV5 } from "@/lib/notion/ids";

export function staffExternalId(appUserId: string): string {
  return uuidV5(`staff:${appUserId}`);
}
