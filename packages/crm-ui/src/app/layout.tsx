// crm-port: Next "Metadata" type -> the same fields as a plain object.
import type { ReactNode } from "react";

// crm-port: `import "./globals.css"` -> the same globals.css compiled with Tailwind 4 and
// scoped to the CRM root (styles/crm.generated.css), attached by CrmDocument.
import { CrmDocument } from "@/crm-port/document";
import { QueryProvider } from "@/components/query-provider";

export const metadata: { title: string; description: string } = {
  title: "MK Jewels CRM",
  description: "MK Jewels in-house customer relationship management system",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // crm-port: <html lang="en"><body> -> the CRM root element inside the JewelOS page.
    <CrmDocument title={metadata.title}>
      <QueryProvider>{children}</QueryProvider>
    </CrmDocument>
  );
}
