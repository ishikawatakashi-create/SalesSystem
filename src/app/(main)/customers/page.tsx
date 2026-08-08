import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

/** 互換: /customers → /organizations?relationship=customer */
export default async function CustomersCompatPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const raw = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s?.trim()) qs.set(k, s.trim());
  }
  if (!qs.has("relationship")) qs.set("relationship", "customer");
  redirect(`/organizations?${qs.toString()}`);
}
