import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "営業管理システム",
  description: "社内向け営業管理システム",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
