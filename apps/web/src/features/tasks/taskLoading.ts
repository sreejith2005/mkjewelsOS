export function shouldShowTaskLoading(loading: boolean, hasCompletedInitialLoad: boolean): boolean {
  return loading && !hasCompletedInitialLoad;
}
