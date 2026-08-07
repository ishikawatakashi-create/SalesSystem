import { NextResponse } from "next/server";

import { AuthError, requirePermission, requireUser } from "@/lib/auth/require";
import {
  buildGmailAuthorizeUrl,
  createOAuthState,
} from "@/lib/integrations/gmail/oauth";
import { gmailOAuthEnvConfigured } from "@/lib/integrations/gmail/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    requirePermission(user, "settings.manage");
    if (!gmailOAuthEnvConfigured()) {
      return NextResponse.redirect(
        new URL(
          "/admin/integrations/gmail?error=env",
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        ),
      );
    }
    const state = await createOAuthState(user.id);
    const url = buildGmailAuthorizeUrl(state);
    return NextResponse.redirect(url);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.redirect(
        new URL("/login", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
      );
    }
    return NextResponse.redirect(
      new URL(
        "/admin/integrations/gmail?error=oauth_start",
        process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ),
    );
  }
}
