/** The customer master reads the audited customer RPCs through the shared data layer. */
export {
  CUSTOMER_LIST_PAGE_SIZE, loadCustomerClientPage, loadCustomerInteractionPage, loadCustomerList, loadCustomerListFilters,
  loadCustomerProfile, loadCustomerTimeline, loadCustomerReviewList, decideCustomerReview, setCustomerDataReview, loadCustomerReviewQueue,
  loadCustomerTable, loadCustomerTableFields, loadCustomerTableValues,
  loadCustomerStdOverview, loadCustomerStdQueue, decideCustomerStd, loadCustomerStdRules, endCustomerStdRule, reviewCustomerStdDraft,
  setCustomerStdPolicy, reprocessCustomerStd, loadCustomerRefValues, saveCustomerRefValue,
} from "@jewelos/data/customers/api";
export type {
  CustomerAnswer, CustomerAppointment, CustomerClientPage, CustomerFollowUp, CustomerInteractionPage, CustomerProduct,
  CustomerProfile, CustomerTimelineEntry, CustomerReviewItem, CustomerReviewResult, CustomerReviewSide,
  CustomerReviewQueueItem, CustomerReviewQueueKind, CustomerReviewQueuePage, CustomerTablePage, CustomerFieldStandard,
  CustomerStdOverview, CustomerStdField, CustomerStdQueue, CustomerStdQueueItem, CustomerStdDecision, CustomerStdRule, CustomerRefValue, CustomerRefOption,
} from "@jewelos/data/customers/api";
