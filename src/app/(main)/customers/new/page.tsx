import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthError, requireUser } from "@/lib/auth/require";
import { hasPermission } from "@/lib/auth/permissions";
import { loadCustomerFormOptions } from "@/features/customers/options";
import { CustomerForm } from "@/features/customers/customer-form";

export const dynamic = "force-dynamic";

export default async function CustomerNewPage() {
  try {
    const user = await requireUser();
    // URL直打ちでもServer側で拒否する(UI非表示に依存しない)
    if (!hasPermission(user.role, "customer.edit")) {
      redirect("/customers");
    }
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    throw e;
  }

  const options = await loadCustomerFormOptions();

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold">顧客登録</h1>
        <Link
          href="/customers"
          className="ml-auto text-xs text-slate-500 hover:text-slate-900"
        >
          一覧へ戻る
        </Link>
      </div>
      <CustomerForm meta={{ mode: "create" }} options={options} />
    </div>
  );
}
