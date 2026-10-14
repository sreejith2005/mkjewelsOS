import type { ReactNode } from "react";
import wordmarkUrl from "@/assets/mk-jewels-wordmark.png";
import { ThemeToggle, type Theme } from "@/components/ThemeToggle";

/** A soft gold glow behind full-screen brand surfaces (sign-in, loading). */
function BrandGlow() {
  return <>
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] bg-[radial-gradient(ellipse_at_top,rgb(var(--color-gold)/0.18),transparent_65%)]" />
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[40vh] bg-[radial-gradient(ellipse_at_bottom,rgb(var(--color-gold-secondary)/0.10),transparent_70%)]" />
  </>;
}

/** Sign-in and password screens: the wordmark over one centred card. */
export function AuthLayout({ children, theme, onThemeChange }: { children: ReactNode; theme: Theme; onThemeChange: (theme: Theme) => void }) {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-obsidian px-5 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(4.5rem,env(safe-area-inset-top))]">
      <BrandGlow />
      <ThemeToggle className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))]" onChange={onThemeChange} theme={theme} />
      <section className="glass-card relative w-full max-w-md rounded-3xl p-7 duration-500 animate-in fade-in slide-in-from-bottom-4 sm:p-9">
        <div className="mb-7 flex flex-col items-center">
          <img alt="MK Jewels" className="h-6 w-auto drop-shadow-[0_1px_0_rgb(var(--color-gold-secondary)/0.35)] sm:h-7" src={wordmarkUrl} />
          <span aria-hidden className="gold-rule mt-4 h-px w-28" />
        </div>
        {children}
      </section>
      <p className="relative mt-6 text-[11px] font-medium uppercase tracking-[0.24em] text-soft-grey">JewelOS · Retail operations</p>
    </main>
  );
}

/** Full-screen wait (session restore, opening the CRM). */
export function BrandedLoading({ label }: { label: string }) {
  return (
    <main aria-busy="true" className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden bg-obsidian px-6">
      <BrandGlow />
      <img alt="MK Jewels" className="relative h-6 w-auto duration-700 animate-in fade-in" src={wordmarkUrl} />
      <div aria-hidden className="skeleton relative mt-6 h-0.5 w-40 rounded-full bg-gold/20" />
      <p className="relative mt-4 text-sm text-soft-grey" role="status">{label}</p>
    </main>
  );
}

/** In-shell wait while a section's code loads: the outline of a page instead of a bare word. */
export function PageLoading() {
  return (
    <div aria-busy="true" aria-label="Loading section" className="space-y-4 duration-300 animate-in fade-in" role="status">
      <div className="skeleton h-8 w-48 rounded-lg" />
      <div className="skeleton h-4 w-72 max-w-full rounded-md" />
      <div className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <div className="skeleton h-28 rounded-2xl" key={index} />)}
      </div>
    </div>
  );
}
