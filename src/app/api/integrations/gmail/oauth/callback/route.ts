import { NextResponse } from "next/server";

import { completeGmailOAuth } from "@/lib/integrations/gmail/oauth";
import { appUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google OAuth callback。
 * code/state 以外のクエリは使わず、token を URL に残さない。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const base = appUrl().replace(/\/$/, "");

  if (!code || !state) {
    return NextResponse.redirect(
      `${base}/admin/integrations/gmail?error=oauth_denied`,
    );
  }

  try {
    const result = await completeGmailOAuth({ code, state });
    if (!result.ok) {
      return NextResponse.redirect(
        `${base}/admin/integrations/gmail?error=${encodeURIComponent(result.reason)}`,
      );
    }
    return NextResponse.redirect(
      `${base}/admin/integrations/gmail?connected=1`,
    );
  } catch {
    return NextResponse.redirect(
      `${base}/admin/integrations/gmail?error=oauth_failed`,
    );
  }
}
