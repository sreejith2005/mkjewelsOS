import { useEffect, useState } from "react";
import { loadMyOrgScope } from "@jewelos/data/users/franchise";
import { titleCase } from "@/lib/format";
import type { UserProfile } from "@/types";

/**
 * The role name shown in the header. A Director is stored as the Admin role
 * with director scope grants (migration 0397), so an Admin's own scope is read
 * once to name them "Director". Display only: the database decides access.
 */
export function useRoleLabel(profile: Pick<UserProfile, "id" | "user_role">): string {
  const base = titleCase(profile.user_role);
  const [director, setDirector] = useState(false);
  useEffect(() => {
    setDirector(false);
    if (profile.user_role !== "admin") return;
    let live = true;
    loadMyOrgScope()
      .then((scope) => { if (live) setDirector(!scope.companyScope && scope.authorities.includes("director")); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [profile.id, profile.user_role]);
  return director ? "Director" : base;
}
