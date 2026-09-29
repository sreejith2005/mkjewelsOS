// crm-port: replaces next/link. Renders the /crm-prefixed href (as Next's basePath did) and
// navigates client-side; modified clicks and new-tab opens keep the native link behaviour.
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";

import { useCrmNavigation } from "@/crm-port/navigation-context";
import { withBasePath } from "@/crm-port/runtime";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

export default function Link({ href, onClick, children, prefetch: _prefetch, replace = false, scroll: _scroll, ...rest }: LinkProps) {
  const { router } = useCrmNavigation();
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    event.preventDefault();
    if (replace) router.replace(href);
    else router.push(href);
  }
  return <a {...rest} href={withBasePath(href)} onClick={handleClick}>{children}</a>;
}
