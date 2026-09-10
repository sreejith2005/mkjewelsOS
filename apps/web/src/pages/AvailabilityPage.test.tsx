import { describe, expect, it } from "vitest";

describe("Availability coverage integration", () => {
  it("captures a range and renders the profile coverage outcome", async () => {
    const source = await import("./AvailabilityPage?raw").then((module) => module.default);
    expect(source).toContain("Availability start date");
    expect(source).toContain("Availability end date");
    expect(source).toContain("Coverage result:");
    expect(source).toContain("secondary_buddy");
    expect(source).toContain('timeZone: "Asia/Kolkata"');
  });

  it("gives every signed-in user their own week card and keeps the team board authorized", async () => {
    const source = await import("./AvailabilityPage?raw").then((module) => module.default);
    // The week card renders on `profile` alone - no role gate - while the
    // department overview and team list stay behind canLogOthers.
    expect(source).toContain("{profile ? <MyWeekAvailability onSaved={() => void load()} userProfileId={profile.id} /> : null}");
    expect(source).toContain("{canLogOthers ? <><section");
    expect(source).not.toContain('"Your current working status for today."');
  });
});

describe("Self-service week card", () => {
  it("lets a user mark past and coming days of the current week in one save", async () => {
    const source = await import("@/features/availability/MyWeekAvailability?raw").then((module) => module.default);
    expect(source).toContain("availabilityWeekDays");
    expect(source).toContain("recordAvailabilityDays");
    // Present is the default, and every exception status stays reachable.
    expect(source).toContain('statuses.get(date) ?? "present"');
    for (const status of ["absent", "half_day", "remote", "present"]) expect(source).toContain(`status: "${status}"`);
    // Whole-week, earlier-this-week, and today-onwards selections.
    expect(source).toContain("week.map((day) => day.date)");
    expect(source).toContain("week.filter((day) => day.isPast)");
    expect(source).toContain("week.filter((day) => !day.isPast)");
    // An absence reports who picked the work up.
    expect(source).toContain("coverage_required");
  });
});
