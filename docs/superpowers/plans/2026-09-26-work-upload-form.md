# Work and upload form implementation

1. Define the requested form with the existing section, branch, rule, option, and field types. Register it from Forms Library through the existing audited draft and publish RPCs.
2. Add a shared, opt-in step navigator for this form. Both web and native render one reachable section at a time, validate before Next, follow the actual route on Back, and show route-based progress.
3. Clear answers for newly hidden fields whenever a previous answer changes. Keep the existing submission RPC, private upload registration, and dynamic user dropdowns.
4. Test all listed branches, hidden-answer cleanup, existing continuous forms, web and native type/build gates, then release the native update under the repository guide.
