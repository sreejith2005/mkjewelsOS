# Ask Kiara: testing on production

For the owner. Ask Kiara is live on https://mkjewels-os.vercel.app. **Since 2026-10-14 it is
switched on for everyone** (you told us so before Phase 9). Sections 1-3 below are the
earlier owner tests and the pilot method, kept for reference. **Section 4 is the final
launch checklist** and section 5 is how to switch it off again.

Use a computer browser (Chrome), or Chrome on a phone. Ask Kiara is not in the Android app
yet (it comes with the next app update); employees who open a Kiara notification in the
Android app see "Open on web for now".

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

## 2. Check that employees can't see it yet (only while it was dark; no longer needed)

- Ask any employee to refresh the web app. **Ask Kiara** is not in their menu, and opening
  https://mkjewels-os.vercel.app/ask-kiara shows that the section is unavailable.
- Already checked from the database at deploy time: the Ask Kiara section is off for the company,
  and only Super Admin accounts can open it.
- In the top bar, **Developer Mode** shows how many sections are off ("· 1 off" or more). Turn
  Developer Mode on and the **Ask Kiara** switch is shown as off.

## 3. Small pilot with 2-3 trusted employees (only if you ever go back to a pilot)

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

## 4. Switch on for everyone: final checklist (Phase 9)

Ask Kiara is already on for everyone. This checklist makes sure that is really true for every
role, then does one last check. It takes about 15 minutes. Do it on a computer, signed in as
Super Admin. **You switch things; Claude never does.**

**A. The section switch is on**
1. Settings → section **Developer mode**: the **Ask Kiara** box in the list of sections is
   ticked. (Or: top bar → **Developer Mode** on → the **Ask Kiara** switch is on.)
2. If it is not ticked: tick it and press **Save developer controls**.

**B. No role has "Use Ask Kiara" taken away**
1. Settings → **Open permission management** → tab **Roles**.
2. Click **Admin**. Under **Assistant**, look at **Use Ask Kiara**:
   - ticked and no small round arrow next to it: fine, go to the next role;
   - a small round arrow next to it (**Reset Use Ask Kiara to default**): click the arrow, then
     **Save 1 change**. The arrow means the role was changed from the default (for example
     during a pilot).
3. Do the same for **Manager**, **HR**, **CRM**, **Staff**, **Doer** and **Housekeeping**.
   Super Admin always has it.
4. Tab **Departments**: pick each department in turn. The **Use Ask Kiara** row must say
   **Inherit** (not Disable). Fix any that say Disable and press **Save department access**.
5. Tab **Designations**: no designation may have **Use Ask Kiara** set to **Deny**. Fix and press
   **Save designation**.
6. Tab **Users**: a person's own **Deny** still beats everything. That is how you keep Kiara from
   one person on purpose. Leave those as they are. Personal **Grant** rows from a pilot can stay;
   they change nothing now.

**C. "Ask a person" reaches managers**
Managers, Admins and Super Admin have **Answer escalated questions** by default. If you changed
it for a role, reset it the same way as in B (Roles → the role → **Answer escalated questions**).
HR does not answer by default; tick it for HR only if you want HR to answer too.

**D. The daily limit**
Ask Kiara → **Limits**. The company limit should be **10 questions per person per day** (the
default). Super Admin is always unlimited. Remove any pilot exceptions you no longer want
("Remove" next to the name). Change the number if you want a different limit; it applies from
each person's next question.

**E. Final check with two real accounts** (ask the people to do it with you, on their own login)
1. One **staff** member refreshes the page. **Ask Kiara** is in the menu.
   - They ask: **aaj mera kya pending hai?** The answer matches their Home screen.
   - They ask: **How do I apply for leave?** They get short steps.
   - They ask a question from one of your SOPs (for example about opening the store). The answer
     has a **Sources** chip that opens the right SOP.
   - They ask: **How is the whole branch doing this week?** Kiara says they don't have access to
     branch numbers (or gives only their own work and says so).
   - The counter at the top shows **questions left today** out of 10.
2. One **manager** refreshes. **Ask Kiara** is in the menu.
   - They ask: **Meri team mein sabse zyada overdue kiske hain?** The names are only from their
     team and match Task Control.
   - They open the **Questions for you** tab (it may be empty).
3. If either person does not see Ask Kiara after a refresh, go back to B for their role,
   department and designation, and check their own row on the Users tab.

**F. Tell everyone**
Send the message in `docs/ASK_KIARA_EMPLOYEE_ANNOUNCEMENT.md` (English and Hinglish) on WhatsApp.
The one-page "How to use Kiara" in the same file can be printed or shared as a picture.

## 5. Roll back quickly

**For everyone at once (fastest):** top bar → **Developer Mode** on → click the **Ask Kiara**
switch off (or Settings → Developer mode → untick **Ask Kiara** → **Save developer controls**).
Everyone except Super Admin loses access at once: the menu entry goes, and the server refuses
their questions. Nothing is deleted. Conversations, documents and questions stay, and come back
when you switch it on again.

**For one role:** Settings → Open permission management → **Roles** → the role → untick **Use
Ask Kiara** → **Save 1 change**.

**For one person:** Settings → Open permission management → **Users** → search the person → row
**Use Ask Kiara** → **Deny** → **Save access**.

**To stop spending without switching it off:** Ask Kiara → **Limits** → set the company limit
to **0**. Nobody except Super Admin can ask a question until you set it back.

If something looks wrong in answers, note the question and the time and tell Claude. Don't paste
customer phone numbers into the chat.

## 6. Daily question limit

- Default: **10 questions per person per day**. Super Admin is unlimited.
- Change it on the **Limits** tab (section 7 below).

## 7. Phase 6: Insights, Limits, and clean-up

New in Phase 6. All of it is in **Ask Kiara**, as extra tabs at the top. You see a tab only if
you are allowed to use it.

### Insights (who needs SOP training)

**Who sees it.** Super Admin and Admin see everyone in the company. A manager sees only the
people who report to them (directly or further down). Nobody sees their own row. Staff don't
see the tab. Nobody, not even Super Admin, can read anyone's questions. Insights show only
labels and counts.

**How to open it.** Ask Kiara → **Insights**.

**What each card shows**
- **Rating 1 to 5**: an AI estimate of how well the person knows the SOPs, from the questions
  they asked Kiara in the **last 60 days**. Higher is better.
- **Class**:
  - **Fresher** (rating 1 or 2): asks many basic questions, asks the same thing again on other
    days, or often needs a person to answer. A good candidate for SOP training.
  - **Experienced** (rating 3): knows the basics and asks about routine work.
  - **Veteran** (rating 4 or 5): mostly asks about exceptions and harder cases.
- **Summary**: one or two lines on what they mostly ask about.
- **Counts**: SOP questions, on how many days, all questions, and the last day they were active.
  Under a rated card: how many were basic, asked again on another day, or sent to a person.
- **Asks most about / SOPs used most / SOP departments**: useful for planning which training to
  give.

**Not enough questions yet.** A rating needs at least **8 SOP questions on 4 different days**
in the last 60 days. Until then the card says **Not enough questions yet**. Questions about the
app or about someone's own tasks still show in the counts, but don't make a rating.

**Filters.** Branch, Department, Class (including "Not enough questions yet"). **Sort by**
Rating or Activity.

**When it updates.** Every night at about 2:30 am. Kiara labels the new questions in the
background; results normally appear within an hour after that.

**Refresh insights now (Super Admin only).** On the Insights tab, click **Refresh insights
now** to label today's new questions without waiting for the night. You can do this once an
hour. Results usually appear within an hour: come back and reload the page. If it says "the
insights job is not set up yet", tell Claude.

It is an estimate to plan training. Don't use it for appraisals.

### Limits (Super Admin only)

Ask Kiara → **Limits**. Admins and managers can't open this tab, and the permission can't be
given to anyone else.

**Company limit.** Questions per person per day (0 to 500; the default is 10). Change the
number and click **Save**. It applies from the person's **next question**. The day resets at
midnight India time. Super Admin never has a limit.

**Keep chats for.** How many days chats are kept (30 to 730; default 180). Older chats are
deleted every night. The text-free question counts used by Insights are kept for 365 days.
Questions sent to a person ("Ask a person") and their answers are not deleted.

**A person's exception.** Click **Add or change a person**, type part of their name or employee
code, and pick them. Choose:
- **Own limit**: a number, higher or lower than the company limit (0 means no questions); or
- **Unlimited**.
Add a note if you like (for example "pilot user"). Click **Save exception**. To put someone
back on the company limit, click **Remove** next to their name. Every change is recorded in
the audit log.

People with no limit (Super Admin, or an Unlimited exception) no longer see the
"questions left" chip in the chat. Everyone else still does.

**Usage.** At the bottom of the Limits tab: **Today**, **Last 7 days** or **Last 30 days**. Each
row is one person: their limit, the questions they asked each day (for up to 7 days), and the
total. The last row is the total for everyone. A number in red means they used their whole
limit that day. A question Kiara could not answer is given back and is not counted.

### Phase 6 checks on production

1. Ask Kiara → **Limits**. Set the company limit to **3**, Save. With a test employee who has
   Ask Kiara, ask 4 questions: the 4th is refused with the reset time. Set it back to 10.
2. Give that employee an exception of **Unlimited**. In their chat, the "questions left" chip
   is gone. Remove the exception: the chip is back.
3. Usage → **Today**: the test employee's questions are listed with the right total.
4. Ask Kiara → **Insights** → **Refresh insights now**. The button then shows it can be used
   again in an hour. After about an hour, reload: people who asked questions appear (most will
   say "Not enough questions yet" at first).
5. Sign in as a manager: Insights lists only people who report to them, and not the manager.
   Sign in as staff: there is no Insights or Limits tab.
6. Nothing to check for the clean-up: old chats are deleted automatically every night, and a
   new company (tenant) would start with Ask Kiara switched off.

## 8. Phase 7: Ask Kiara by voice

New in Phase 7. People can speak a question instead of typing it.

**Who sees the mic.** A mic button appears next to **Send** in the Ask Kiara chat for people with
**Ask Kiara by voice**. By default that is **Super Admin, Admin and Manager**. HR, Staff and the
other roles don't have it unless you give it to them. They still type as before.

**How to use it**
1. Tap the **mic** next to Send. The first time, the browser asks to use the microphone: choose
   **Allow**.
2. Speak your question in **Hindi, Hinglish or English**. The box above the input shows
   **Recording**, the seconds left (60 seconds at most) and a level bar that moves when you speak.
3. Tap the **stop** button (the square). After a moment the words appear in the input box.
4. **Read and correct the words**, then press **Send**. Nothing is sent until you press Send.
   If you already typed something, the spoken words are added after it.

Turning speech into text **does not use one of the daily questions**. Only pressing Send does.
Voice recordings are not saved anywhere. Each person can record about **40 voice clips an hour**,
and that allowance is **shared with Tasks voice** (assigning tasks by voice).

**Messages you may see**
- *Microphone access was blocked*: allow the microphone for this site (the mic or lock icon in the
  address bar), then try again.
- *That was too short*: hold on a little longer; record at least one second.
- *Nothing was heard in the recording* or *Your voice was not heard clearly*: speak closer to the
  phone or computer and try again.
- *Too many voice recordings in the last hour*: type the question, or wait a while.

**Give voice to someone else** (Settings → Permission management)
- A whole role (for example HR): **Roles** tab → click the role → under **Assistant**, tick
  **Ask Kiara by voice** → **Save 1 change**.
- One person: **Users** tab → search and click the person → row **Ask Kiara by voice** →
  **Grant** → **Save access**. **Deny** in the same row takes it away from one person even if
  their role has it.
- The person must also be able to use Ask Kiara itself (**Use Ask Kiara**). They see the mic
  after they reload the page.

### Phase 7 checks on production

Use **desktop Chrome** once and **Chrome on an Android phone** (the web app, not the APK) once.

1. Sign in as a Manager. Ask Kiara shows a mic next to Send. Sign in as a Staff member (or HR):
   there is no mic.
2. **Hindi**: tap the mic and say "मेरे आज के पेंडिंग टास्क कौन से हैं?" ("Mere aaj ke pending
   task kaun se hain?"). The words appear in the box, in Hindi or in Latin letters. Nothing is
   sent yet. Correct a word if needed, press **Send**, and check the answer.
3. **Hinglish**: say "Leave apply karne ka process kya hai?". Check the words, press Send and check
   the answer.
4. **English**: say "How do I apply for leave?". Check, Send.
5. Tap the mic and stay silent for 3 seconds, then stop: a "not heard" message appears and the
   box stays empty.
6. **Tasks voice still works**: go to Tasks → **Assign Task** (or the round mic button on other
   pages), record "Ask <a team member's name> to count the display stock by tomorrow 5 pm". The
   form fills in with that person and deadline as before. Close it without assigning, or assign
   and delete the test task.
7. Optional: in Settings → Permission management → **Users**, Grant **Ask Kiara by voice** to one
   staff member. After a reload they see the mic. Remove the Grant afterwards.
