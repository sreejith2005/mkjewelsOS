// Every route and key state captured in BOTH apps with the same app path and the same actions.
// Paths are CRM app paths; the harness prefixes each app's origin + "/crm" (the original
// basePath, kept by the port). `roles` limits a state to the roles it applies to.
const ALL = ["super_admin", "branch_manager", "salesperson"];
const STAFF = ["branch_manager", "salesperson"];
const A = "a0000000-0000-4000-8000-00000000000a";
const C = "a0000000-0000-4000-8000-00000000000c";

async function selectMatching(locator, pattern) {
  const value = await locator.evaluate((select, source) => {
    const regex = new RegExp(source, "i");
    const option = [...select.options].find((item) => regex.test(item.textContent ?? "") && item.value);
    return option ? option.value : null;
  }, pattern.source);
  if (value === null) throw new Error(`no option matching ${pattern} in ${await locator.getAttribute("aria-label")}`);
  await locator.selectOption(value);
}

const chooseClient = async (page) => { await page.getByRole("button", { name: /^CLIENT/ }).click(); };
const engagementRow = (page, label) => page.locator(".legacy-walkin-card .grid", { has: page.locator("b", { hasText: new RegExp(`^${label}$`) }) });

async function expandWalkInForm(page) {
  await selectMatching(page.getByLabel("Source of lead"), /^reference$/);
  await page.getByLabel("CRM / salesperson").selectOption({ index: 1 });
  await page.getByLabel("Salesperson attending the client").selectOption({ index: 1 });
  await page.getByLabel("Gender").selectOption("FEMALE");
  await page.getByLabel("Same as mobile number").check();
  await selectMatching(page.getByLabel("Community / caste"), /^other/);
  await page.getByLabel("Occupation").selectOption("OTHER");
  await page.getByLabel("Bridal / non-bridal").selectOption("BRIDAL");
  await page.getByLabel("Wedding month").selectOption("DECEMBER");
  await page.getByLabel("Wedding year").selectOption({ index: 2 });
  await page.getByLabel("Communication preference").selectOption("WHATSAPP MESSAGE");
  await page.getByLabel("How many family members / friends are with them?").selectOption("2");
  await page.getByLabel("Client bought any product?").selectOption("YES");
  for (const group of ["Product categories seen by the client", "Bought product categories"]) {
    const set = page.getByRole("group", { name: group });
    await set.locator("label").filter({ hasText: /^OTHER/i }).first().click();
    await set.locator("label").nth(0).click();
  }
  await page.getByLabel("Number of products client has seen").selectOption("2");
  await page.getByLabel("How many products did the client buy?").selectOption("2");
  await page.getByLabel("Did the client make any other / new order?").selectOption("YES");
  const orders = page.getByRole("group", { name: "Order / new-things categories" });
  await orders.locator("label").filter({ hasText: /^OTHER/i }).first().click();
  await page.getByLabel("How many products in the order?").selectOption("1");
  await page.getByRole("radio", { name: "YES" }).check();
  for (const kind of ["Instagram follow", "Google review", "Testimonial", "Feedback form", "Thank-you note", "Referrals"]) {
    await engagementRow(page, kind).locator("select").first().selectOption("yes");
  }
  await page.getByLabel("How many referrals?").selectOption("2");
  await selectMatching(page.getByLabel("Beverage"), /^other/);
  await selectMatching(page.getByLabel("Snack"), /^other/);
  await selectMatching(page.getByLabel("Gift given"), /^other/);
  await page.getByLabel("Client potential category").selectOption("Hot Lead");
  await page.getByRole("button", { name: "Add more photo" }).click();
}

export function statesFor(ids) {
  const asha = ids["client:asha"];
  const bhavna = ids["client:bhavna"];
  return [
    // Root redirect and the original proxy's signed-in /login redirect both land on /queue.
    { id: "root-redirect", roles: ["salesperson"], path: "/" },
    { id: "login-redirect", roles: ["salesperson"], path: "/login" },

    { id: "queue-choice", roles: ALL, path: "/queue" },
    { id: "queue-client-active", roles: STAFF, path: "/queue", act: chooseClient },
    { id: "queue-client-recent", roles: STAFF, path: "/queue", act: async (page) => { await chooseClient(page); await page.getByRole("button", { name: "Recently submitted" }).click(); } },
    { id: "queue-admin-no-branch", roles: ["super_admin"], path: "/queue", act: chooseClient },
    { id: "queue-admin-branch", roles: ["super_admin"], path: `/queue?branch=${A}`, act: chooseClient },
    { id: "queue-admin-empty-branch", roles: ["super_admin"], path: `/queue?branch=${C}`, act: chooseClient },
    { id: "queue-crm-filter", roles: ["salesperson"], path: `/queue?branch=${A}&crm=ANU+PARITY`, act: chooseClient },
    { id: "queue-completed", roles: ["salesperson"], path: `/queue?completed=Parity%20Bhavna%20Rao&completedClientId=${bhavna}`, act: chooseClient },
    { id: "queue-register-error", roles: ["salesperson"], path: "/queue", act: async (page) => { await chooseClient(page); await page.getByRole("button", { name: "REGISTER CLIENT" }).click(); } },
    { id: "queue-lead", roles: ALL, path: "/queue", act: async (page) => { await page.getByRole("button", { name: /^LEAD/ }).click(); } },
    { id: "queue-lead-error", roles: ["salesperson"], path: "/queue", act: async (page) => { await page.getByRole("button", { name: /^LEAD/ }).click(); await page.getByRole("button", { name: "Save lead" }).click(); } },

    { id: "visit-form", roles: ALL, path: `/visits/new?queue=${ids["queue:new"]}` },
    { id: "visit-form-existing", roles: ["salesperson"], path: `/visits/new?queue=${ids["queue:existing"]}` },
    { id: "visit-form-expanded", roles: ["salesperson", "super_admin"], path: `/visits/new?queue=${ids["queue:new"]}`, act: expandWalkInForm },
    { id: "visit-form-validation", roles: ["salesperson"], path: `/visits/new?queue=${ids["queue:new"]}`, act: async (page) => { await page.getByRole("button", { name: "Submit complete visit" }).click(); } },
    { id: "visit-form-without-queue", roles: ["salesperson"], path: "/visits/new" },

    { id: "dashboard", roles: ALL, path: "/dashboard" },
    { id: "dashboard-all", roles: ["salesperson"], path: "/dashboard?mode=ALL" },
    { id: "dashboard-week", roles: ["salesperson"], path: "/dashboard?mode=WEEK" },
    { id: "dashboard-date-filter", roles: ["salesperson"], path: "/dashboard", act: async (page) => { await page.getByLabel("Filter type").selectOption("DATE_TO_DATE"); } },
    { id: "dashboard-empty-range", roles: ["salesperson"], path: "/dashboard?mode=DATE_TO_DATE&startDate=2001-01-01&endDate=2001-01-02" },

    { id: "clients", roles: ALL, path: "/clients" },
    { id: "clients-search", roles: ["salesperson"], path: "/clients?search=Parity+Asha" },
    { id: "clients-empty", roles: ["salesperson"], path: "/clients?search=zz-no-match" },
    { id: "clients-walkin-branch-choice", roles: ["super_admin"], path: "/clients", act: async (page) => { await page.getByRole("button", { name: "Make Walk-in Entry" }).first().click(); } },
    { id: "topbar-search-results", roles: ["salesperson"], path: "/clients", act: async (page) => { await page.getByLabel("Search client", { exact: true }).fill("Parity"); await page.getByText("Parity Asha Mehta").first().waitFor(); } },
    { id: "topbar-search-none", roles: ["salesperson"], path: "/clients", act: async (page) => { await page.getByLabel("Search client", { exact: true }).fill("zz-none"); await page.waitForTimeout(400); await page.getByText("Searching…").waitFor({ state: "detached", timeout: 30_000 }).catch(() => undefined); await page.getByText("No client found").waitFor(); } },

    { id: "client-new", roles: ALL, path: "/clients/new?phone=9100000999" },
    { id: "client-new-error", roles: ["salesperson"], path: "/clients/new", act: async (page) => { await page.getByRole("button", { name: "Create client" }).click(); } },

    { id: "client-profile", roles: ALL, path: `/clients/${asha}` },
    { id: "client-profile-edit", roles: ["salesperson"], path: `/clients/${asha}`, act: async (page) => { await page.getByRole("button", { name: "EDIT PROFILE" }).click(); } },
    { id: "client-profile-edit-timeline", roles: ["salesperson"], path: `/clients/${asha}`, act: async (page) => { await page.getByRole("button", { name: "EDIT PROFILE" }).click(); await page.getByRole("button", { name: "Timeline", exact: true }).click(); } },
    { id: "client-profile-edit-audit", roles: ["salesperson"], path: `/clients/${asha}`, act: async (page) => { await page.getByRole("button", { name: "EDIT PROFILE" }).click(); await page.getByRole("button", { name: "Audit log", exact: true }).click(); } },
    { id: "client-profile-walkin-branch", roles: ["super_admin"], path: `/clients/${asha}`, act: async (page) => { await page.getByRole("button", { name: "Make Walk-in Entry" }).click(); } },
    { id: "client-not-found", roles: ["salesperson"], path: "/clients/00000000-0000-4000-8000-000000000000" },
    { id: "unknown-route", roles: ["salesperson"], path: "/no-such-crm-page" },

    ...[["today", "TODAY FOLLOW UP"], ["pending", "ALL PENDING FOLLOW UP"], ["inprocess", "INPROCESS FOLLOW UP"], ["done", "ALL DONE"]].map(([key, label]) => ({
      id: `followups-${key}`, roles: key === "today" ? ALL : ["salesperson"], path: "/followups",
      act: async (page) => { await page.getByRole("button", { name: label, exact: true }).click(); },
    })),
    { id: "followups-form", roles: ["salesperson"], path: "/followups", act: async (page) => { await page.getByRole("button", { name: "ALL PENDING FOLLOW UP", exact: true }).click(); await page.getByRole("button", { name: "FOLLOW UP FORM" }).first().click(); } },
    { id: "followups-form-error", roles: ["salesperson"], path: "/followups", act: async (page) => { await page.getByRole("button", { name: "ALL PENDING FOLLOW UP", exact: true }).click(); await page.getByRole("button", { name: "FOLLOW UP FORM" }).first().click(); await page.getByLabel("Follow Up Remark").fill(""); await page.getByRole("button", { name: "Save", exact: true }).click(); } },
    { id: "followups-history", roles: ["salesperson"], path: "/followups", act: async (page) => { await page.getByRole("button", { name: "ALL PENDING FOLLOW UP", exact: true }).click(); await page.getByRole("button", { name: "VIEW HISTORY" }).first().click(); } },
    { id: "followups-crm-filter", roles: ["salesperson"], path: "/followups", act: async (page) => { await page.getByRole("button", { name: "ALL PENDING FOLLOW UP", exact: true }).click(); await page.getByLabel("CRM name").selectOption({ index: 1 }); } },

    ...[["today", "TODAY FOLLOW UP"], ["pending", "ALL PENDING"], ["inprocess", "INPROCESS"], ["done", "ALL DONE"], ["converted", "CONVERTED TO CLIENT"]].map(([key, label]) => ({
      id: `referrals-${key}`, roles: key === "today" ? ALL : ["salesperson"], path: "/referrals",
      act: async (page) => { await page.getByRole("button", { name: label, exact: true }).click(); },
    })),
    { id: "referrals-form-error", roles: ["salesperson"], path: "/referrals", act: async (page) => { await page.getByRole("button", { name: "ALL PENDING", exact: true }).click(); await page.getByRole("button", { name: "FOLLOW UP FORM" }).first().click(); await page.getByRole("button", { name: "SAVE FOLLOW UP" }).click(); } },
    { id: "referrals-history", roles: ["salesperson"], path: "/referrals", act: async (page) => { await page.getByRole("button", { name: "ALL PENDING", exact: true }).click(); await page.getByRole("button", { name: "VIEW HISTORY" }).first().click(); } },

    { id: "allocation", roles: STAFF, path: "/allocation" },
    { id: "allocation-admin", roles: ["super_admin"], path: `/allocation?branch=${A}` },
    { id: "allocation-edit", roles: ["branch_manager", "super_admin"], path: `/allocation?branch=${A}`, act: async (page) => { await page.getByRole("button", { name: "EDIT" }).first().click(); } },
    { id: "allocation-add-error", roles: ["branch_manager"], path: "/allocation", act: async (page) => { await page.getByRole("button", { name: "ADD", exact: true }).click(); } },

    { id: "leads-new", roles: ["salesperson"], path: "/leads/new" },
    { id: "drawer-open", roles: ALL, path: "/dashboard", act: async (page) => { await page.getByRole("button", { name: "Open navigation menu" }).click(); await page.waitForTimeout(400); } },
  ];
}
