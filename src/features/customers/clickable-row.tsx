"use client";

import { useRouter } from "next/navigation";

/** 行クリックで詳細へ遷移するテーブル行。中のリンク・ボタンのクリックは妨げない */
export function ClickableRow({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  return (
    <tr
      className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${className ?? ""}`}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest("a,button,input,select")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
