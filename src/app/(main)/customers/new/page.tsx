import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type RawParams = Record<string, string | string[] | undefined>;

export default async function CustomersNewCompatPage({
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
  const suffix = qs.toString();
  redirect(suffix ? `/organizations/new?${suffix}` : "/organizations/new");
}
