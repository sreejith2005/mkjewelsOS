/** The customer master reads the audited customer RPCs through the shared data layer. */
export {
  CUSTOMER_LIST_PAGE_SIZE, loadCustomerClientPage, loadCustomerInteractionPage, loadCustomerList, loadCustomerListFilters,
  loadCustomerProfile, loadCustomerTimeline,
} from "@jewelos/data/customers/api";
export type {
  CustomerAnswer, CustomerAppointment, CustomerClientPage, CustomerFollowUp, CustomerInteractionPage, CustomerProduct,
  CustomerProfile, CustomerTimelineEntry,
} from "@jewelos/data/customers/api";
