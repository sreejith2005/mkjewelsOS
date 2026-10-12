# Ask Kiara: testing on production

For the owner. Ask Kiara is live on https://mkjewels-os.vercel.app but **switched off for
everyone except Super Admin**. Employees cannot see it or use it until you switch it on.

Use a computer browser (Chrome). Ask Kiara is not in the Android app yet; employees who open a
Kiara notification on the phone see "Open on web for now".

## 1. Smoke test (as Super Admin)

1. Sign in as Super Admin. **Ask Kiara** is in the menu. Open it.
2. Ask: **aaj mera kya pending hai?** The answer matches your own Home screen, in Hinglish.
3. Ask: **How is the company doing this week?** You get figures matching the Dashboard.
4. Ask: **aaj kitne walk-ins aaye?** The number matches the CRM Dashboard for today.
5. Ask: **Mere follow-ups?** The list matches CRM Follow-ups. Phone numbers show only the last 4
   digits, and each client has a link to the CRM record.
6. Knowledge base, with two SOPs first:
   - Open the **Knowledge base** tab and click **Upload .docx**. Pick 2 SOP files.
   - Wait until both show **Ready**.
   - Open each document and set **Departments** and **Who can get answers from it**
     (Everyone, Only these departments, or Managers and above). Save.
   - Go back to **Chat** and ask one question about each SOP, in your own words.
   - Each answer shows a source chip under **Sources**. Click it: it opens the right SOP section.
7. Then upload the rest: **Upload .docx**, select all the remaining files. Choose
   **Who can get answers** and the departments for this batch before uploading. You can change
   several documents at once later with the tick boxes and **Set visibility or departments**.
   If a file shows **Failed**, click **Retry**.
8. The chip at the top of the chat says **Unlimited questions**. Super Admin has no daily limit.

If an answer looks wrong, note the question and the time and send them to me. Don't paste
customer phone numbers into the chat with me.

## 2. Check that employees can't see it yet

- Ask any employee to refresh the web app. **Ask Kiara** is not in their menu, and opening
  https://mkjewels-os.vercel.app/ask-kiara shows that the section is unavailable.
- Already checked from the database at deploy time: the Ask Kiara section is off for the company,
  and only Super Admin accounts can open it.
- In the top bar, **Developer Mode** shows how many sections are off ("· 1 off" or more). Turn
  Developer Mode on and the **Ask Kiara** switch is shown as off.

## 3. Small pilot with 2-3 trusted employees

Switching the section on opens it for **every role that has "Use Ask Kiara"**, which is every role
by default. So for a pilot, first take the permission away from all roles. Then give it back to
named people. Then switch the section on. **Do the steps in this order.** If the section is on
before step 2 is saved, everyone sees Ask Kiara for that moment.

Why this works: a person's own setting (Users tab) beats their role's setting. A section that is
switched off beats everything except Super Admin. So the section must be on, and the roles must
be denied.

**Step 1: deny it for every role** (Settings → Permission management → **Roles**)
1. Click **Admin**. Under **Assistant**, untick **Use Ask Kiara**. Click **Save 1 change**.
2. Do the same for **Manager**, **HR**, **CRM**, **Staff**, **Doer** and **Housekeeping**.
   Super Admin can't be changed; it always has access.
3. Open the **Departments** tab. Pick each department in turn and check that the Ask Kiara row
   says **Inherit**, not Enable. Then open the **Designations** tab and check that no designation
   has **Use Ask Kiara** set to **Grant**. An Enable or Grant there beats the role setting. A new
   install has none.

**Step 2: grant it to the pilot people** (Settings → Permission management → **Users**)
1. Search for the employee by name and click them.
2. In the row **Use Ask Kiara**, choose **Grant**. Click **Save access**.
3. Repeat for each pilot employee.
4. Also grant it to **each pilot employee's manager** (the person they report to), and to their
   **department head** and **branch manager** if those are different people. When an employee
   uses "Ask a person", these people get the "Question for you" notification. Without the grant
   they get the notification but can't open the question.

**Step 3: switch the section on**
1. In the top bar, click **Developer Mode** to turn it on. A row of section switches appears.
2. Click the **Ask Kiara** switch so it is on. Click **Developer Mode** again to hide the row.
3. Ask one non-pilot employee to refresh. Ask Kiara must **not** be in their menu. If it is,
   switch the section off again (section 5 below) and check step 1.

**Test "Ask a person"** (one pilot employee and their manager)
1. The employee asks a policy question that is in **no** SOP, for example "Can I carry forward
   unused leave to next year?" If an SOP does answer it, Kiara answers with a source chip instead.
   Then pick another question that no SOP covers.
2. Kiara searches the SOPs, says it could not find it, and offers **Ask a person**. The employee
   clicks it.
3. The manager gets a notification "Question for you from …", and a number badge on **Ask Kiara**
   in the menu. They open Ask Kiara → **Questions for you**, type the answer and click **Answer**.
   They can tick **Save to knowledge base**. That creates a **Suggested** document that you approve
   or reject in the Knowledge base tab.
4. The employee gets a notification. The answer appears in the same chat. If they ask a follow-up
   in that chat, Kiara takes the person's answer into account.

Employees have **10 questions a day**. After the 10th, Kiara tells them when the limit resets
(midnight India time).

## 4. Switch it on for everyone (later)

Phase 9 does this formally, after the remaining phases. When you decide to:
1. Settings → Permission management → **Roles**: for each role you denied in the pilot, click the
   **reset** arrow next to **Use Ask Kiara** (or tick it again). Click **Save**.
2. Leave the section switch on.

The pilot people's personal Grant can stay; it changes nothing once the role has it.

## 5. Roll back quickly

Top bar → **Developer Mode** on → click the **Ask Kiara** switch off. Everyone except Super Admin
loses access at once: the menu entry goes, and the server refuses their questions. Nothing is
deleted. Conversations, documents and questions stay, and come back when you switch it on again.

## 6. Daily question limit

- Default: **10 questions per person per day**. Super Admin is unlimited.
- There is no screen to change it yet. **Phase 6 adds the Limits screen**, with a company limit
  and per-person exceptions. Until then the default of 10 applies.
