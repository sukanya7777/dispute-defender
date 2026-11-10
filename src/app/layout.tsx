import type { Metadata } from "next";
import "./globals.css";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = {
  title: "Dispute Defender",
  description: "An AI agent that fights PayPal disputes for small sellers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopBar />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
