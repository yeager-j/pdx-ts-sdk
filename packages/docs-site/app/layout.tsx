import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Provider } from "@/components/provider";

import "./global.css";

export const metadata: Metadata = {
  title: {
    template: "%s | @pdx-ts/sdk",
    default: "@pdx-ts/sdk",
  },
  description: "TypeScript SDK for generating Stellaris mods",
  icons: { icon: "/favicon.svg" },
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
