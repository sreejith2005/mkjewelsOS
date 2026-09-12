import { describe, expect, it } from "vitest";
import { describeWriteError, WriteRejected, writeError } from "./writeErrors.ts";

// The exact text Postgres returned on the device, from image 5 of the
// 2026-09-12 report.
const DUPLICATE_DROPDOWN =
  'duplicate key value violates unique constraint "dropdown_masters_tenant_id_master_type_value_key"';

describe("describeWriteError", () => {
  it("re-words a duplicate dropdown value", () => {
    expect(describeWriteError(DUPLICATE_DROPDOWN)).toBe(
      "A dropdown item with this value already exists in this category.",
    );
  });

  it("finds the constraint wherever it sits in the message", () => {
    expect(
      describeWriteError(
        'ERROR: duplicate key value violates unique constraint "dropdown_masters_tenant_id_master_type_value_key" (SQLSTATE 23505)',
      ),
    ).not.toBeNull();
  });

  it("says nothing for a message it does not recognise", () => {
    expect(describeWriteError("permission denied for table dropdown_masters")).toBeNull();
    expect(describeWriteError("")).toBeNull();
  });
});

describe("writeError", () => {
  it("carries the mapped wording as the message a client will show", () => {
    const error = writeError(DUPLICATE_DROPDOWN);
    expect(error.message).toBe("A dropdown item with this value already exists in this category.");
  });

  it("keeps the database's own text for diagnostics", () => {
    const error = writeError(DUPLICATE_DROPDOWN);
    expect(error).toBeInstanceOf(WriteRejected);
    expect((error as WriteRejected).technicalMessage).toBe(DUPLICATE_DROPDOWN);
  });

  // A wrong guess reads worse than a technical truth, so an unmapped failure
  // keeps the server's wording rather than becoming "Something went wrong".
  it("passes an unmapped message through unchanged", () => {
    const error = writeError("permission denied for table dropdown_masters");
    expect(error.message).toBe("permission denied for table dropdown_masters");
    expect(error).not.toBeInstanceOf(WriteRejected);
  });

  it("is always a real Error, so a client's catch behaves normally", () => {
    expect(writeError(DUPLICATE_DROPDOWN)).toBeInstanceOf(Error);
    expect(writeError("anything")).toBeInstanceOf(Error);
  });
});
