// crm-port: the original has no not-found.tsx, so an unknown CRM URL (at the root) or a page's
// notFound() (inside the (crm) layout) rendered Next 16's default 404 (next/dist/client/
// components/http-access-fallback/error-fallback.js, access-error-styles.js). Same markup and inline
// styles; its <style> targeted body and is scoped to the CRM root here, at the tier of the
// original unlayered rules (see scripts/build-css.mjs) so it overrides globals.css as in Next.
import { useEffect, type CSSProperties } from "react";

const styles: Record<"error" | "desc" | "h1" | "h2", CSSProperties> = {
  error: {
    fontFamily: 'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
    height: "100vh",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  desc: { display: "inline-block" },
  h1: { display: "inline-block", margin: "0 20px 0 0", padding: "0 23px 0 0", fontSize: 24, fontWeight: 500, verticalAlign: "top", lineHeight: "49px" },
  h2: { fontSize: 14, fontWeight: 400, lineHeight: "49px", margin: 0 },
};

const ROOT = ".crm-root#crm-root#crm-root#crm-root#crm-root";
const scopedFallbackCss = `${ROOT}{color:#000;background:#fff;margin:0}${ROOT} .next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){${ROOT}{color:#fff;background:#000}${ROOT} .next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}`;

export function NextNotFound() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "404: This page could not be found.";
    return () => { document.title = previousTitle; };
  }, []);
  return (
    <div style={styles.error}>
      <div>
        <style dangerouslySetInnerHTML={{ __html: scopedFallbackCss }} />
        <h1 className="next-error-h1" style={styles.h1}>404</h1>
        <div style={styles.desc}>
          <h2 style={styles.h2}>This page could not be found.</h2>
        </div>
      </div>
    </div>
  );
}
