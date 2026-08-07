import { NextResponse } from "next/server";

import {
  handleNotionWebhookPost,
  methodNotAllowed,
} from "@/lib/webhooks/notion-webhook-handler";

/** raw body を読むため Node.js runtime 必須 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleNotionWebhookPost(request);
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET() {
  const result = methodNotAllowed();
  return NextResponse.json(result.body, { status: result.status });
}

export async function PUT() {
  const result = methodNotAllowed();
  return NextResponse.json(result.body, { status: result.status });
}

export async function PATCH() {
  const result = methodNotAllowed();
  return NextResponse.json(result.body, { status: result.status });
}

export async function DELETE() {
  const result = methodNotAllowed();
  return NextResponse.json(result.body, { status: result.status });
}
