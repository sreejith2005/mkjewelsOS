// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const rpc = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const pincodeMaybeSingle = vi.fn();
const pincodeActiveFilter = { maybeSingle: pincodeMaybeSingle };
const pincodePincodeFilter = { eq: vi.fn(() => pincodeActiveFilter) };
const pincodeSelect = vi.fn(() => ({ eq: vi.fn(() => pincodePincodeFilter) }));
const from = vi.fn(() => ({ select: pincodeSelect }));

vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ push }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc,
    from,
    storage: {
      from: () => ({ upload, remove }),
    },
  }),
}));

import { WalkInForm } from "@/components/walk-in-form";
import type { Client } from "@/lib/supabase/app-types";

const branchId = "10000000-0000-4000-8000-000000000501";

function renderWalkInForm() {
  return render(
    <WalkInForm
      profile={{ role: "salesperson", branchId, name: "Test CRM" }}
      branches={[{ id: branchId, name: "Test Branch" }]}
      crms={["Test CRM"]}
      queue={null}
      client={null}
    />,
  );
}

function renderPrefilledWalkInForm() {
  return render(<WalkInForm profile={{ role: "salesperson", branchId, name: "Test CRM" }} branches={[{ id: branchId, name: "Test Branch" }]} crms={["Test CRM"]} queue={null} client={{ client_id: "20000000-0000-4000-8000-000000000501", primary_name: "Known Client", primary_phone: "9012345678" } as unknown as Client} />);
}
function renderQueuedWalkInForm() {
  return render(<WalkInForm profile={{ role: "salesperson", branchId, name: "Test CRM" }} branches={[{ id: branchId, name: "Test Branch" }]} crms={["Test CRM"]} queue={{ id: "queue-501", client_name: "Queue Client", mobile: "9012345509", branch_id: branchId, assigned_crm_name: "Test CRM", client_id: null, status: "pending" }} client={null} />);
}

function openEngagementStep() {
  fireEvent.click(screen.getByRole("button", { name: "5. Engagement asks" }));
}

function engagementRow(label: string) {
  return screen.getByText(label).closest("div");
}

function answerRequiredEngagements(overrides: Record<string, string> = {}) {
  openEngagementStep();
  for (const label of ["Instagram follow", "Google review", "Testimonial", "Feedback form", "Thank-you note", "Referrals"]) {
    const row = engagementRow(label);
    expect(row).not.toBeNull();
    fireEvent.change(within(row!).getByRole("combobox"), { target: { value: (overrides[label] ?? "no").toLowerCase() } });
  }
}

function completeLegacyRequiredFields(status = "YES") {
  fireEvent.click(screen.getByRole("button", { name: "1. Client & visit" }));
  fireEvent.change(screen.getByLabelText("Salesperson attending the client"), { target: { value: "Test CRM" } });
  fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
  fireEvent.change(screen.getByLabelText("Billing phone"), { target: { value: "9012345670" } });
  fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "FEMALE" } });
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "India" } });
  fireEvent.change(screen.getByLabelText("State"), { target: { value: "Maharashtra" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Mumbai" } });
  fireEvent.change(screen.getByLabelText("Pincode"), { target: { value: "400001" } });
  fireEvent.change(screen.getByLabelText("Address"), { target: { value: "Test address" } });
  fireEvent.change(screen.getByLabelText("Community / caste"), { target: { value: "OTHER" } });
  fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
  fireEvent.change(screen.getByLabelText("Occupation"), { target: { value: "BUSINESS OWNER" } });
  fireEvent.change(screen.getByLabelText("Bridal / non-bridal"), { target: { value: "NON BRIDAL" } });
  fireEvent.change(screen.getByLabelText("Communication preference"), { target: { value: "CALL" } });
  fireEvent.click(screen.getByRole("button", { name: "4. Purchase outcome" }));
  fireEvent.change(screen.getByLabelText("Client bought any product?"), { target: { value: status } });
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

beforeEach(() => {
  pincodeMaybeSingle.mockResolvedValue({ data: null, error: null });
});

describe("WalkInForm proof image uploads", () => {
  it("opens with an IST datetime-local value and the walk-in lead source selected", () => {
    renderWalkInForm();
    expect((screen.getByLabelText("Visit date and time") as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect((screen.getByLabelText("Source of lead") as HTMLSelectElement).value).toBe("Walk-in");
    expect((screen.getByLabelText("Client type") as HTMLSelectElement).value).toBe("new");
  });

  it("clears and reloads CRM and salesperson choices when a super-admin selects another branch", () => {
    const otherBranchId = "10000000-0000-4000-8000-000000000502";
    render(<WalkInForm profile={{ role: "super_admin", branchId: null, name: "Admin" }} branches={[{ id: branchId, name: "Andheri" }, { id: otherBranchId, name: "Bandra" }]} crms={[]} crmByBranch={{ [branchId]: ["Andheri CRM"], [otherBranchId]: ["Bandra CRM"] }} queue={null} client={null} />);
    const branch = screen.getByLabelText("Branch") as HTMLSelectElement;
    const crm = screen.getByLabelText("CRM / salesperson") as HTMLSelectElement;
    const salesperson = screen.getByLabelText("Salesperson attending the client") as HTMLSelectElement;
    expect(salesperson.disabled).toBe(true);
    fireEvent.change(branch, { target: { value: branchId } });
    expect(Array.from(crm.options).map((option) => option.value)).toEqual(["", "Andheri CRM"]);
    fireEvent.change(crm, { target: { value: "Andheri CRM" } });
    fireEvent.change(salesperson, { target: { value: "Andheri CRM" } });
    fireEvent.change(branch, { target: { value: otherBranchId } });
    expect(crm.value).toBe("");
    expect(salesperson.value).toBe("");
    expect(Array.from(salesperson.options).map((option) => option.value)).toEqual(["", "Bandra CRM"]);
  });

  it("uses legacy source, bridal, occupation, and category reveal rules", () => {
    render(<WalkInForm profile={{ role: "salesperson", branchId, name: "Test CRM" }} branches={[{ id: branchId, name: "Test Branch" }]} crms={["Test CRM"]} queue={null} client={null} lookups={{ productCategories: ["Ring", "Other"], notBoughtReasons: [], beverages: [], snacks: [] }} />);
    fireEvent.change(screen.getByLabelText("Source of lead"), { target: { value: "Reference" } });
    expect(screen.getByLabelText("Reference name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.change(screen.getByLabelText("Bridal / non-bridal"), { target: { value: "NON BRIDAL" } });
    expect(screen.queryByLabelText("Wedding month")).toBeNull();
    fireEvent.change(screen.getByLabelText("Bridal / non-bridal"), { target: { value: "BRIDAL" } });
    expect(screen.getByLabelText("Wedding month")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Occupation"), { target: { value: "OTHER" } });
    expect(screen.getByLabelText("Occupation other")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "4. Purchase outcome" }));
    fireEvent.change(screen.getByLabelText("Client bought any product?"), { target: { value: "YES" } });
    fireEvent.click(within(screen.getByLabelText("Product categories seen by the client")).getByText("Other"));
    expect(screen.getByLabelText("Other (seen category)")).toBeTruthy();
  });

  it("uses the literal legacy controls for wedding, communication, and marketing fields", () => {
    renderWalkInForm();
    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.change(screen.getByLabelText("Bridal / non-bridal"), { target: { value: "BRIDAL" } });

    const weddingMonth = screen.getByLabelText("Wedding month") as HTMLSelectElement;
    const weddingYear = screen.getByLabelText("Wedding year") as HTMLSelectElement;
    const communication = screen.getByLabelText("Communication preference") as HTMLSelectElement;
    expect(weddingMonth.tagName).toBe("SELECT");
    expect(Array.from(weddingMonth.options).map((option) => option.value)).toEqual(["", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]);
    expect(Array.from(weddingYear.options).map((option) => option.value)).toEqual(["", ...Array.from({ length: 11 }, (_, index) => String(new Date().getFullYear() + index))]);
    expect(Array.from(communication.options).map((option) => option.value)).toEqual(["", "CALL", "WHATSAPP CALLS", "WHATSAPP MESSAGE", "DON'T CONTACT"]);

    fireEvent.click(screen.getByRole("button", { name: "4. Purchase outcome" }));
    const visitStatus = screen.getByLabelText("Client bought any product?") as HTMLSelectElement;
    expect(Array.from(visitStatus.options).map((option) => option.value)).toContain("YES");
    expect(Array.from(visitStatus.options).map((option) => option.value)).toContain("NO");
    fireEvent.change(visitStatus, { target: { value: "YES" } });
    expect(visitStatus.value).toBe("YES");
  });
  it("auto-fills a matched phone profile and keeps a manually edited value", async () => {
    rpc.mockImplementation((name: string) => name === "lookup_client_by_phone" ? Promise.resolve({ data: [{ client_id: "20000000-0000-4000-8000-000000000599", primary_name: "Phone Match", primary_phone: "9012345599", gender: "Female", dob: "1990-01-02", community: "Nair", address: "Main Road", pincode: "682001", country: "India", state: "Kerala", city: "Kochi" }], error: null }) : Promise.resolve({ data: [], error: null }));
    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345599" } });
    await waitFor(() => expect(screen.getByDisplayValue("Phone Match")).toBeTruthy());
    expect((screen.getByLabelText("Client type") as HTMLSelectElement).value).toBe("existing");
    fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
    await waitFor(() => expect(screen.getByDisplayValue("FEMALE")).toBeTruthy());
    expect(screen.getAllByText("Auto-filled from client history — editable").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByDisplayValue("FEMALE"), { target: { value: "OTHER" } });
    expect(screen.getByDisplayValue("OTHER")).toBeTruthy();
  });

  it("leaves typed values in place when the phone has no matching client", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "Unmatched Client" } });
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345598" } });
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(screen.getByDisplayValue("Unmatched Client")).toBeTruthy();
    expect(screen.queryByText("Auto-filled from client history — editable")).toBeNull();
  });

  it("returns to the queue with the completed client confirmation after submission", async () => {
    rpc.mockImplementation((name: string) => name === "lookup_client_by_phone" ? Promise.resolve({ data: [], error: null }) : Promise.resolve({ data: [{ client_id: "20000000-0000-4000-8000-000000000509", timeline_id: "40000000-0000-4000-8000-000000000509", reference_number: "TES-260725-0001" }], error: null }));
    renderQueuedWalkInForm();
    completeLegacyRequiredFields("STORE_VISIT");
    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit complete visit" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/queue?completed=Queue%20Client&completedClientId=20000000-0000-4000-8000-000000000509"));
  });

  it("never submits from beverage changes or implicit form submits", async () => {
    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "No Auto Submit" } });
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345597" } });
    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.change(screen.getByLabelText("Beverage"), { target: { value: "Tea" } });
    expect(rpc).not.toHaveBeenCalledWith("submit_walkin_visit", expect.anything());
    fireEvent.submit(screen.getByRole("button", { name: "Submit complete visit" }).closest("form")!);
    expect(await screen.findByText("Use Submit complete visit to save this form.")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("submit_walkin_visit", expect.anything());
  });

  it("keeps values when staff return to an earlier step and edit the profile", () => {
    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "Editable Visit" } });
    fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
    fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "FEMALE" } });
    fireEvent.click(screen.getByRole("button", { name: "1. Client & visit" }));
    expect(screen.getByDisplayValue("Editable Visit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
    expect((screen.getByLabelText("Gender") as HTMLSelectElement).value).toBe("FEMALE");
  });

  it("uses the legacy gender choices and synchronizes billing phone only while requested", () => {
    renderWalkInForm();
    fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
    const gender = screen.getByLabelText("Gender") as HTMLSelectElement;
    expect(Array.from(gender.options).map((option) => option.value)).toEqual(["", "FEMALE", "MALE", "OTHER"]);
    fireEvent.click(screen.getByRole("button", { name: "1. Client & visit" }));
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345678" } });
    fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
    fireEvent.click(screen.getByLabelText("Same as mobile number"));
    expect((screen.getByLabelText("Billing phone") as HTMLInputElement).value).toBe("9012345678");
    fireEvent.click(screen.getByRole("button", { name: "1. Client & visit" }));
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345679" } });
    fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
    expect((screen.getByLabelText("Billing phone") as HTMLInputElement).value).toBe("9012345679");
    fireEvent.click(screen.getByLabelText("Same as mobile number"));
    expect((screen.getByLabelText("Billing phone") as HTMLInputElement).disabled).toBe(false);
  });

  it("looks up a six-digit pincode and keeps the filled location editable", async () => {
    pincodeMaybeSingle.mockResolvedValue({ data: { city: "Kochi", state: "Kerala", country: "India" }, error: null });
    renderWalkInForm();
    fireEvent.click(screen.getByRole("button", { name: "2. Profile" }));
    fireEvent.change(screen.getByLabelText("Pincode"), { target: { value: "682001" } });
    await waitFor(() => expect(screen.getByDisplayValue("Kochi")).toBeTruthy());
    expect(screen.getByDisplayValue("Kerala")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("Kochi"), { target: { value: "Ernakulam" } });
    expect(screen.getByDisplayValue("Ernakulam")).toBeTruthy();
  });

  it("prefills an existing client for a make walk-in entry shortcut", () => { renderPrefilledWalkInForm(); expect(screen.getByDisplayValue("Known Client")).toBeTruthy(); expect(screen.getByDisplayValue("9012345678")).toBeTruthy(); expect(screen.getByText("Existing client detected")).toBeTruthy(); });
  it("reveals an image upload control when an engagement ask is yes and keeps it hidden when no", () => {
    renderWalkInForm();
    openEngagementStep();

    const instagram = engagementRow("Instagram follow");
    expect(instagram).not.toBeNull();
    const instagramControls = within(instagram!);
    const instagramSelect = instagramControls.getByRole("combobox");

    fireEvent.change(instagramSelect, { target: { value: "yes" } });
    expect(instagramControls.getByLabelText("Instagram follow proof image")).toBeTruthy();
    expect(instagramControls.getByText("Proof image is required.")).toBeTruthy();

    fireEvent.change(instagramSelect, { target: { value: "no" } });
    expect(instagramControls.queryByLabelText("Instagram follow proof image")).toBeNull();
    expect(instagramControls.getByPlaceholderText("Reason")).toBeTruthy();
  });

  it("accepts only the named proof formats and rejects a PDF before upload", async () => {
    renderWalkInForm();
    openEngagementStep();
    const instagram = within(engagementRow("Instagram follow")!);
    fireEvent.change(instagram.getByRole("combobox"), { target: { value: "yes" } });
    const picker = instagram.getByLabelText("Instagram follow proof image") as HTMLInputElement;
    expect(picker.accept).toBe(".jpg,.jpeg,.png,.webp,.heic,.heif");
    expect(screen.getAllByText(/Allowed: JPEG, PNG, WebP, HEIC, or HEIF image/).length).toBeGreaterThan(0);

    fireEvent.change(picker, { target: { files: [new File(["not an image"], "proof.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByText("Only JPEG, PNG, WebP, HEIC, or HEIF image files are allowed.")).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it("submits an uploaded proof image and keeps the Storage object after a successful visit", async () => {
    rpc.mockImplementation((name: string) => name === "submit_walkin_visit"
      ? Promise.resolve({ data: [{ client_id: "20000000-0000-4000-8000-000000000501", timeline_id: "40000000-0000-4000-8000-000000000501", reference_number: "TES-260727-0001" }], error: null })
      : Promise.resolve({ data: [], error: null }));
    upload.mockResolvedValueOnce({ error: null });
    remove.mockResolvedValue({ error: null });

    const originalRandomUUID = crypto.randomUUID;
    const ids = [
      "20000000-0000-4000-8000-000000000501",
      "40000000-0000-4000-8000-000000000501",
      "50000000-0000-4000-8000-000000000501",
    ];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => ids.shift() ?? originalRandomUUID.call(crypto));

    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "Uploaded Proof Client" } });
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345503" } });
    completeLegacyRequiredFields();
    answerRequiredEngagements({ "Google review": "YES" });

    const googleReview = engagementRow("Google review");
    expect(googleReview).not.toBeNull();
    const googleReviewControls = within(googleReview!);
    fireEvent.change(googleReviewControls.getByRole("combobox"), { target: { value: "yes" } });
    fireEvent.change(
      googleReviewControls.getByLabelText("Google review proof image"),
      { target: { files: [new File(["proof"], "review proof (1).jpg", { type: "image/jpeg" })] } },
    );

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    const storagePath = upload.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit complete visit" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("submit_walkin_visit", expect.objectContaining({
      p_payload: expect.objectContaining({
        documents: [{ storage_path: storagePath, file_name: "review_proof__1_.jpg", mime_type: "image/jpeg" }],
      }),
    })));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/queue?completed=Uploaded%20Proof%20Client&completedClientId=20000000-0000-4000-8000-000000000501"));
    expect(remove).not.toHaveBeenCalled();
  });

  it("uses the resolved existing client UUID for a proof uploaded before the lookup effect finishes", async () => {
    const existingClientId = "20000000-0000-4000-8000-000000000777";
    rpc.mockImplementation((name: string) => name === "lookup_client_by_phone"
      ? Promise.resolve({ data: [{ client_id: existingClientId, primary_name: "Existing Proof Client", primary_phone: "9012345777" }], error: null })
      : Promise.resolve({ data: [{ client_id: existingClientId, timeline_id: "40000000-0000-4000-8000-000000000777", reference_number: "TES-260729-0001" }], error: null }));
    upload.mockResolvedValueOnce({ error: null });

    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "Existing Proof Client" } });
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345777" } });
    completeLegacyRequiredFields();
    answerRequiredEngagements({ "Google review": "YES" });

    const googleReview = engagementRow("Google review");
    fireEvent.change(
      within(googleReview!).getByLabelText("Google review proof image"),
      { target: { files: [new File(["proof"], "existing-proof.jpg", { type: "image/jpeg" })] } },
    );

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload.mock.calls[0][0]).toMatch(new RegExp(`^${existingClientId}/`));
  });

  it("keeps uploaded proof images when submit_walkin_visit fails", async () => {
    rpc.mockImplementation((name: string) => name === "submit_walkin_visit"
      ? Promise.resolve({ data: null, error: { message: "forced transaction failure" } })
      : Promise.resolve({ data: [], error: null }));
    upload.mockResolvedValueOnce({ error: null });
    remove.mockResolvedValue({ error: null });

    const originalRandomUUID = crypto.randomUUID;
    const ids = [
      "20000000-0000-4000-8000-000000000501",
      "40000000-0000-4000-8000-000000000501",
      "50000000-0000-4000-8000-000000000501",
    ];
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => ids.shift() ?? originalRandomUUID.call(crypto));

    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "Upload Failure Client" } });
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345501" } });
    completeLegacyRequiredFields();
    answerRequiredEngagements({ "Google review": "YES" });

    const googleReview = engagementRow("Google review");
    expect(googleReview).not.toBeNull();
    const googleReviewControls = within(googleReview!);
    fireEvent.change(googleReviewControls.getByRole("combobox"), { target: { value: "yes" } });
    const proof = new File(["proof"], "review-proof.jpg", { type: "image/jpeg" });
    fireEvent.change(googleReviewControls.getByLabelText("Google review proof image"), { target: { files: [proof] } });

    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    const uploadedPath = upload.mock.calls[0][0];
    expect(uploadedPath).toBe("20000000-0000-4000-8000-000000000501/40000000-0000-4000-8000-000000000501/50000000-0000-4000-8000-000000000501_review-proof.jpg");

    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit complete visit" }));

    await waitFor(() => expect(rpc).toHaveBeenCalledWith("submit_walkin_visit", expect.any(Object)));
    expect(remove).not.toHaveBeenCalled();
    expect(await screen.findByText("We could not save this visit. Please try again; if it persists, contact an administrator. Uploaded proof files were kept so you do not need to add them again.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not mislabel an unrelated database validation failure as a proof-link failure", async () => {
    rpc.mockImplementation((name: string) => name === "submit_walkin_visit"
      ? Promise.resolve({ data: null, error: { code: "23514", message: "new row violates check constraint visit_forms_wedding_year_check" } })
      : Promise.resolve({ data: [], error: null }));
    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "Validation Client" } });
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345504" } });
    completeLegacyRequiredFields();
    answerRequiredEngagements();
    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit complete visit" }));
    expect(await screen.findByText("Wedding month or year is invalid. Select the wedding details again before submitting.")).toBeTruthy();
  });

  it("blocks submission when an engagement ask is yes without an uploaded proof image", async () => {
    renderWalkInForm();
    fireEvent.change(screen.getByLabelText("Client name *"), { target: { value: "Missing Proof Client" } });
    fireEvent.change(screen.getByLabelText("Mobile *"), { target: { value: "9012345502" } });
    completeLegacyRequiredFields();
    answerRequiredEngagements({ Testimonial: "YES" });

    const testimonial = engagementRow("Testimonial");
    expect(testimonial).not.toBeNull();
    fireEvent.change(within(testimonial!).getByRole("combobox"), { target: { value: "yes" } });

    fireEvent.click(screen.getByRole("button", { name: "6. Preferences & planning" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit complete visit" }));

    expect(await screen.findByText("Testimonial needs a proof image before submission.")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("submit_walkin_visit", expect.any(Object));
    expect(upload).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
