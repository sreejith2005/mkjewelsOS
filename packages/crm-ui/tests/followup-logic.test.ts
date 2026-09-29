import { describe, expect, it } from "vitest";
import { callOutcomeBucket, legacyNotBoughtHistory, queueTabMatches, sortNotBoughtFollowups } from "@/lib/followup-logic";

describe("legacy follow-up vocabulary", () => {
  it("buckets every non-contact outcome as CALL NOT PICKED", () => {
    for (const outcome of ["NO (CALL NOT CONNECTED)", "RINGING / NOT ANSWERED", "SWITCHED OFF", "BUSY / DECLINED"]) expect(callOutcomeBucket(outcome)).toBe("CALL NOT PICKED");
    expect(callOutcomeBucket("YES (CLIENT NEED FOLLOW-UP)")).toBe("YES (CLIENT NEED FOLLOW-UP)");
  });
  it("partitions queue tabs by legacy status", () => {
    const base={next_followup_date:"2026-07-25",followup_count:0};
    expect(queueTabMatches({status:"PENDING",...base},"today","2026-07-25")).toBe(true);
    expect(queueTabMatches({status:"PENDING",...base},"pending","2026-07-25")).toBe(true);
    expect(queueTabMatches({status:"PENDING",...base},"inprocess","2026-07-25")).toBe(false);
    expect(queueTabMatches({status:"INTERESTED - NEED FOLLOW UP",...base,followup_count:1},"inprocess","2026-07-25")).toBe(true);
    expect(queueTabMatches({status:"ALREADY PURCHASED FROM MK JEWELS",...base},"done","2026-07-25")).toBe(true);
  });
  it("keeps undated historical imports only in All Pending because their source dates are ambiguous", () => {
    const historical={status:"historical",next_followup_date:null,followup_count:0};
    expect(queueTabMatches(historical,"today","2026-07-25")).toBe(false);
    expect(queueTabMatches(historical,"pending","2026-07-25")).toBe(true);
    expect(queueTabMatches(historical,"inprocess","2026-07-25")).toBe(false);
  });
  it("includes overdue open records in Today and recognizes the legacy done status", () => {
    expect(queueTabMatches({status:"PENDING",next_followup_date:"2026-07-24",followup_count:0},"today","2026-07-25")).toBe(true);
    expect(queueTabMatches({status:"FOLLOW UP DONE",next_followup_date:null,followup_count:1},"done","2026-07-25")).toBe(true);
  });
  it("does not classify a newly-created lowercase pending record as in process", () => {
    expect(queueTabMatches({status:"pending",next_followup_date:"2026-07-25",followup_count:0},"inprocess","2026-07-25")).toBe(false);
  });
  it("uses every literal legacy tab filter and excludes ambiguous historical work from Today/Inprocess", () => {
    const records = [
      { status: "PENDING", next_followup_date: null, followup_count: 0 },
      { status: "HISTORICAL", next_followup_date: "2026-07-24", followup_count: 0 },
      { status: "CALL NOT PICKED", next_followup_date: null, followup_count: 1 },
    ];
    expect(records.filter((record) => queueTabMatches(record, "today", "2026-07-25"))).toHaveLength(2);
    expect(records.filter((record) => queueTabMatches(record, "pending", "2026-07-25"))).toHaveLength(3);
    expect(records.filter((record) => queueTabMatches(record, "inprocess", "2026-07-25"))).toEqual([records[2]]);
    expect(records.filter((record) => queueTabMatches(record, "done", "2026-07-25"))).toEqual([]);
  });
  it("orders blank, overdue, and today work oldest-first for the Kolkata Today tab", () => {
    const rows = [
      { next_followup_date: "2026-07-25", visit_date: "2026-07-20", id: "today" },
      { next_followup_date: null, visit_date: "2026-07-21", id: "blank" },
      { next_followup_date: "2026-07-23", visit_date: "2026-07-19", id: "overdue" },
    ];
    expect(sortNotBoughtFollowups(rows, "today").map((row) => row.id)).toEqual(["blank", "overdue", "today"]);
  });
  it("uses exact client and reference history before its literal client-wide fallback", () => {
    const history = [
      { client_id: "client-1", reference_number: "REF-1", id: "exact" },
      { client_id: "client-1", reference_number: "REF-2", id: "client-wide" },
    ];
    expect(legacyNotBoughtHistory(history, "client-1", "REF-1").map((entry) => entry.id)).toEqual(["exact"]);
    expect(legacyNotBoughtHistory(history, "client-1", "MISSING").map((entry) => entry.id)).toEqual(["exact", "client-wide"]);
  });
});
