import { NextResponse } from "next/server";

import {
  handleGmailPubSubPost,
  methodNotAllowed,
} from "@/lib/webhooks/gmail-pubsub-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleGmailPubSubPost(request);
  if (result.status === 204) {
    return new NextResponse(null, { status: 204 });
  }
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
