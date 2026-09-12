const APP_CONFIG = {
  TZ: 'Asia/Kolkata',
  ROOT_FOLDER_ID: '1C85EkCGiTmRXyz8tipxps9ZBGhWFaTwT',
  EVIDENCE_FOLDER_NAME: 'TASK EVIDENCE',
  DEFAULT_PAGE_SIZE: 50,
  SHEETS: {
    USERS: 'LIVE_USERS',
    DEPARTMENTS: 'DEPARTMENTS',
    TEMPLATES: 'TASK_TEMPLATES',
    CHECKLIST_TEMPLATES: 'CHECKLIST_TEMPLATES',
    LIVE_TASKS: 'LIVE_TASKS',
    LIVE_CHECKLISTS: 'LIVE_CHECKLISTS',
    HISTORY: 'TASK_HISTORY',
    CHECKLIST_HISTORY: 'CHECKLIST_HISTORY',
    ATTACHMENTS: 'ATTACHMENT_INDEX',
    AVAILABILITY: 'LEAVE_AVAILABILITY',
    VERIFICATION: 'VERIFICATION',
    AUDIT: 'AUDIT_LOG',
    SUMMARY: 'DASHBOARD_SUMMARY',
    HOLIDAYS: 'HOLIDAY_LIST'
  }
};

const REQUIRED_HEADERS = {
  LIVE_USERS: [
    'USER ID','EMPLOYEE NAME','EMPLOYEE ID','DEPARTMENT','DESIGNATION',
    'REPORTING MANAGER','BRANCH / LOCATION','JOINING DATE','STATUS','EMAIL ADDRESS',
    'CONTACT NUMBER','WORKING DAYS','WEEKLY OFF','SHIFT','SHIFT START TIME','SHIFT END TIME',
    'PRIMARY BUDDY','SECONDARY BUDDY','USER ACCESS','ROLE','CURRENT AVAILABILITY','ACTIVE',
    'CREATED AT','UPDATED AT'
  ],
  DEPARTMENTS: ['DEPARTMENT ID','DEPARTMENT NAME','DEPARTMENT HEAD','STATUS','CREATED AT','UPDATED AT'],
  TASK_TEMPLATES: [
    'TASK TEMPLATE ID','CORE TASK','TASK DESCRIPTION','DEPARTMENT','DESIGNATION / ROLE',
    'DEFAULT USER','DEFAULT USER ID','TASK TYPE','FREQUENCY','FREQUENCY DETAIL',
    'SPECIFIC WEEKDAY','SPECIFIC DATE','START TIME','DUE TIME','PRIORITY',
    'ATTACHMENT REQUIRED','ATTACHMENT TYPE','VERIFICATION REQUIRED','VERIFIER',
    'APPROVAL REQUIRED','APPROVER','BUDDY ALLOWED','ESCALATION RULE','ACTIVE',
    'CREATED BY','CREATED AT','UPDATED AT','TASK START DATE','TASK END DATE',
    'SOURCE','SOURCE KEY','SOURCE CONTROL','SOURCE APP TASK IDS','SOURCE ROW IDS','SCHEDULE STATUS'
  ],
  CHECKLIST_TEMPLATES: [
    'CHECKLIST TEMPLATE ID','TASK TEMPLATE ID','CORE TASK','CHECKLIST SEQUENCE',
    'CHECKLIST ITEM','MANDATORY','EVIDENCE REQUIRED','EVIDENCE TYPE','ACTIVE','CREATED AT','UPDATED AT',
    'SOURCE','SOURCE KEY','SOURCE APP TASK ID','SOURCE ROW ID'
  ],
  LIVE_TASKS: [
    'TASK INSTANCE ID','TASK TEMPLATE ID','TASK DATE','CORE TASK','TASK DESCRIPTION','TASK TYPE','DEPARTMENT',
    'ORIGINAL USER ID','ORIGINAL OWNER','CURRENT ASSIGNEE ID','CURRENT ASSIGNEE','ASSIGNMENT TYPE','BUDDY TASK',
    'ASSIGNED BY','PRIORITY','SCHEDULED START TIME','DUE TIME','ACTUAL START TIME','ACTUAL COMPLETION TIME',
    'STATUS','CHECKLIST TOTAL','CHECKLIST COMPLETED','CHECKLIST PROGRESS %','ATTACHMENT REQUIRED','ATTACHMENT COUNT',
    'VERIFICATION REQUIRED','VERIFICATION STATUS','VERIFIER','APPROVAL REQUIRED','APPROVAL STATUS','APPROVER',
    'ON TIME / DELAYED','DELAY MINUTES','REMARK','CREATED AT','UPDATED AT'
  ],
  LIVE_CHECKLISTS: [
    'TASK INSTANCE ID','CHECKLIST INSTANCE ID','TASK TEMPLATE ID','CHECKLIST TEMPLATE ID','CORE TASK',
    'CHECKLIST SEQUENCE','CHECKLIST ITEM','MANDATORY','STATUS','COMPLETED BY','COMPLETED AT',
    'EVIDENCE REQUIRED','EVIDENCE COUNT','REMARK','CREATED AT','UPDATED AT'
  ],
  TASK_HISTORY: REQUIRED_HISTORY_HEADERS_(),
  CHECKLIST_HISTORY: [
    'TASK INSTANCE ID','CHECKLIST INSTANCE ID','TASK TEMPLATE ID','CHECKLIST TEMPLATE ID','CORE TASK',
    'CHECKLIST ITEM','MANDATORY','STATUS','COMPLETED BY','COMPLETED AT','EVIDENCE REQUIRED','EVIDENCE COUNT','ARCHIVED AT'
  ],
  ATTACHMENT_INDEX: [
    'ATTACHMENT ID','TASK INSTANCE ID','CHECKLIST INSTANCE ID','TASK TEMPLATE ID','FILE NAME','FILE TYPE','FILE URL',
    'DRIVE FILE ID','EVIDENCE TYPE','UPLOADED BY','UPLOADED BY USER ID','UPLOADED DATE','UPLOADED TIME','CREATED AT'
  ],
  LEAVE_AVAILABILITY: [
    'RECORD ID','DATE','USER ID','EMPLOYEE NAME','DEPARTMENT','AVAILABILITY STATUS','LEAVE TYPE','FROM DATE','TO DATE',
    'REASON','APPROVAL STATUS','CREATED BY','CREATED AT','UPDATED AT'
  ],
  VERIFICATION: [
    'VERIFICATION ID','TASK INSTANCE ID','TASK DATE','CORE TASK','PERFORMER','VERIFIER','VERIFICATION STATUS',
    'VERIFICATION REMARK','REJECTED REASON','VERIFIED AT','CREATED AT','UPDATED AT'
  ],
  AUDIT_LOG: [
    'AUDIT ID','TASK INSTANCE ID','CHECKLIST INSTANCE ID','USER ID','USER NAME','ACTION','FIELD NAME','PREVIOUS VALUE',
    'NEW VALUE','DATE','TIME','TIMESTAMP'
  ],
  DASHBOARD_SUMMARY: [
    'SUMMARY DATE','SUMMARY TYPE','DEPARTMENT','USER ID','EMPLOYEE NAME','TOTAL TASKS','COMPLETED','PENDING','IN PROGRESS',
    'OVERDUE','COMPLETED ON TIME','COMPLETED LATE','AWAITING VERIFICATION','REJECTED','BUDDY TASKS','COMPLETION %',
    'ON TIME %','DELAY %','PENDING %','PRODUCTIVITY SCORE','LAST UPDATED'
  ],
  HOLIDAY_LIST: [
    'HOLIDAY ID','DATE','HOLIDAY NAME','BRANCH / LOCATION','ACTIVE','CREATED AT'
  ]
};

function REQUIRED_HISTORY_HEADERS_() {
  return [
    'TASK INSTANCE ID','TASK TEMPLATE ID','TASK DATE','CORE TASK','TASK DESCRIPTION','TASK TYPE','DEPARTMENT',
    'ORIGINAL USER ID','ORIGINAL OWNER','ACTUAL ASSIGNEE ID','ACTUAL ASSIGNEE','ASSIGNMENT TYPE','BUDDY TASK','PRIORITY',
    'SCHEDULED START TIME','DUE TIME','ACTUAL START TIME','ACTUAL COMPLETION TIME','FINAL STATUS','CHECKLIST TOTAL',
    'CHECKLIST COMPLETED','ATTACHMENT COUNT','VERIFICATION STATUS','APPROVAL STATUS','ON TIME / DELAYED','DELAY MINUTES',
    'REMARK','CREATED AT','COMPLETED AT','ARCHIVED AT'
  ];
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Daily Work')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** FRESH V5 SETUP: creates empty structure only. No seed/import/task generation. */
function setupTaskWebApp() {
  const ss = getDb_();
  ss.setSpreadsheetTimeZone(APP_CONFIG.TZ);
  Object.keys(REQUIRED_HEADERS).forEach(function(name) { ensureSheet_(ss, name, REQUIRED_HEADERS[name]); });
  ensureUserIds_();
  normalizeSpecialRoles_();
  initializeSystemSettings_();
  forceMandatoryEvidenceOnLiveTasks_();
  installDailyTrigger_();
  PropertiesService.getScriptProperties().setProperty('DAILY_WORK_DATABASE_ID', ss.getId());
  return {
    success: true,
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    authSetupRequired: authAccountCount_() === 0,
    freshMode: true,
    message: 'Fresh V5 database structure is ready. Add data manually or through Bulk Upload.'
  };
}


/** RUN ONCE AFTER PASTING THE CODE. PRESERVES EXISTING DATA. */

function setDatabaseSpreadsheetId(spreadsheetId) {
  SpreadsheetApp.openById(String(spreadsheetId).trim());
  PropertiesService.getScriptProperties().setProperty('DAILY_WORK_DATABASE_ID', String(spreadsheetId).trim());
  return setupTaskWebApp();
}

function getAppBootstrap() {
  ensureTodayGenerated_();
  markOverdueTasks_();

  const users = getUsersForClient_();
  const departments = getDepartmentsForClient_();
  const currentEmail = safeCurrentEmail_();
  const currentUser = users.find(u => currentEmail && String(u.email).toLowerCase() === currentEmail.toLowerCase()) || null;

  return {
    today: todayKey_(),
    currentEmail,
    currentUser,
    users,
    departments,
    dashboard: getDashboardData({ date: todayKey_() })
  };
}

function getDashboardData(filters) {
  filters = filters || {};
  const date = filters.date || todayKey_();
  const userId = String(filters.userId || '').trim();
  const department = String(filters.department || '').trim();

  let rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS));
  rows = rows.filter(r => dateKey_(r['TASK DATE']) === date);
  if (userId) rows = rows.filter(r => String(r['CURRENT ASSIGNEE ID'] || '') === userId || String(r['ORIGINAL USER ID'] || '') === userId);
  if (department) rows = rows.filter(r => String(r['DEPARTMENT'] || '') === department);

  const total = rows.length;
  const completedStatuses = new Set(['COMPLETED','COMPLETED LATE']);
  const completed = rows.filter(r => completedStatuses.has(upper_(r['STATUS']))).length;
  const inProgress = rows.filter(r => upper_(r['STATUS']) === 'IN PROGRESS').length;
  const overdue = rows.filter(r => upper_(r['STATUS']) === 'OVERDUE').length;
  const awaitingVerification = rows.filter(r => upper_(r['STATUS']) === 'AWAITING VERIFICATION').length;
  const pending = rows.filter(r => ['PENDING','REASSIGNED'].includes(upper_(r['STATUS']))).length;
  const onTime = rows.filter(r => upper_(r['ON TIME / DELAYED']) === 'ON TIME').length;
  const delayed = rows.filter(r => upper_(r['ON TIME / DELAYED']) === 'DELAYED').length;

  return {
    total,
    completed,
    pending,
    inProgress,
    overdue,
    awaitingVerification,
    onTime,
    delayed,
    completionPct: total ? Math.round((completed / total) * 100) : 0,
    onTimePct: completed ? Math.round((onTime / completed) * 100) : 0
  };
}

function listTasks(filters) {
  filters = filters || {};
  const date = filters.date || todayKey_();
  const userId = String(filters.userId || '').trim();
  const department = String(filters.department || '').trim();
  const status = upper_(filters.status || '');
  const search = String(filters.search || '').trim().toLowerCase();

  let tasks = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS));
  tasks = tasks.filter(r => dateKey_(r['TASK DATE']) === date);
  if (userId) tasks = tasks.filter(r => String(r['CURRENT ASSIGNEE ID'] || '') === userId || String(r['ORIGINAL USER ID'] || '') === userId);
  if (department) tasks = tasks.filter(r => String(r['DEPARTMENT'] || '') === department);
  if (status) tasks = tasks.filter(r => upper_(r['STATUS']) === status);
  if (search) tasks = tasks.filter(r => `${r['CORE TASK']} ${r['TASK DESCRIPTION']} ${r['ORIGINAL OWNER']} ${r['CURRENT ASSIGNEE']}`.toLowerCase().includes(search));

  const ids = new Set(tasks.map(r => String(r['TASK INSTANCE ID'])));
  const checklists = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS))
    .filter(c => ids.has(String(c['TASK INSTANCE ID'])));

  const grouped = {};
  checklists.forEach(c => {
    const id = String(c['TASK INSTANCE ID']);
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push({
      checklistInstanceId: String(c['CHECKLIST INSTANCE ID'] || ''),
      text: String(c['CHECKLIST ITEM'] || ''),
      mandatory: yes_(c['MANDATORY']),
      status: upper_(c['STATUS'] || 'PENDING'),
      completedBy: String(c['COMPLETED BY'] || ''),
      completedAt: displayDateTime_(c['COMPLETED AT'])
    });
  });

  tasks.sort((a, b) => timeToMinutes_(a['DUE TIME']) - timeToMinutes_(b['DUE TIME']));

  return tasks.map(r => ({
    taskId: String(r['TASK INSTANCE ID'] || ''),
    templateId: String(r['TASK TEMPLATE ID'] || ''),
    taskDate: dateKey_(r['TASK DATE']),
    coreTask: String(r['CORE TASK'] || ''),
    description: String(r['TASK DESCRIPTION'] || ''),
    department: String(r['DEPARTMENT'] || ''),
    originalOwner: String(r['ORIGINAL OWNER'] || ''),
    currentAssignee: String(r['CURRENT ASSIGNEE'] || ''),
    currentAssigneeId: String(r['CURRENT ASSIGNEE ID'] || ''),
    assignmentType: String(r['ASSIGNMENT TYPE'] || ''),
    priority: upper_(r['PRIORITY'] || 'MEDIUM'),
    startTime: displayTime_(r['SCHEDULED START TIME']),
    dueTime: displayTime_(r['DUE TIME']),
    status: upper_(r['STATUS'] || 'PENDING'),
     workType: upper_(r['TASK TYPE'] || 'TASK'),
    checklistTotal: Number(r['CHECKLIST TOTAL'] || 0),
    checklistCompleted: Number(r['CHECKLIST COMPLETED'] || 0),
    checklistPct: Number(r['CHECKLIST PROGRESS %'] || 0),
    attachmentRequired: yes_(r['ATTACHMENT REQUIRED']),
    attachmentCount: Number(r['ATTACHMENT COUNT'] || 0),
    verificationRequired: yes_(r['VERIFICATION REQUIRED']),
    verificationStatus: upper_(r['VERIFICATION STATUS'] || ''),
    verifier: String(r['VERIFIER'] || ''),
    onTimeDelayed: upper_(r['ON TIME / DELAYED'] || ''),
    delayMinutes: Number(r['DELAY MINUTES'] || 0),
    remark: String(r['REMARK'] || ''),
    checklists: (grouped[String(r['TASK INSTANCE ID'])] || []).sort((a,b) => a.text.localeCompare(b.text))
  }));
}

function addNewTask(payload) {
  payload = payload || {};
  const userId = String(payload.userId || '').trim();
  const coreTask = String(payload.coreTask || '').trim();
  const frequency = upper_(payload.frequency || 'DAILY');
  const startDate = String(payload.startDate || '').trim();

  if (!userId) throw new Error('Please select a user.');
  if (!coreTask) throw new Error('Please enter the task name.');
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Please select a valid task start date.');
  if (!['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME','AS REQUIRED'].includes(frequency)) throw new Error('Invalid task frequency.');

  const users = getUsersRaw_();
  const user = users.find(u => String(u['USER ID'] || '') === userId);
  if (!user) throw new Error('Selected user was not found in LIVE_USERS.');

  const templateId = makeId_('TPL');
  const now = nowStamp_();
  const taskType = 'CORE TASK';
  const weekday = weekdayName_(startDate);
  const specificDate = ['ONE TIME','AS REQUIRED'].includes(frequency) ? startDate : '';
  let frequencyDetail = '';
  if (frequency === 'WEEKLY') frequencyDetail = weekday;
  if (frequency === 'MONTHLY') frequencyDetail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY') frequencyDetail = startDate.slice(5);
  if (frequency === 'YEARLY') frequencyDetail = startDate.slice(5);

  appendObject_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES), {
    'TASK TEMPLATE ID': templateId,
    'CORE TASK': coreTask,
    'TASK DESCRIPTION': String(payload.description || '').trim(),
    'DEPARTMENT': String(payload.department || user['DEPARTMENT'] || '').trim(),
    'BRANCH NAME': String(user['BRANCH / LOCATION'] || '').trim(),
    'DESIGNATION / ROLE': String(user['DESIGNATION'] || '').trim(),
    'DEFAULT USER': String(user['EMPLOYEE NAME'] || '').trim(),
    'DEFAULT USER ID': userId,
    'TASK TYPE': taskType,
    'FREQUENCY': frequency,
    'FREQUENCY DETAIL': frequencyDetail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '',
    'SPECIFIC DATE': specificDate,
    'TASK START DATE': startDate,
    'TASK END DATE': String(payload.endDate || '').trim(),
    'START TIME': String(payload.startTime || '').trim(),
    'DUE TIME': String(payload.dueTime || '').trim(),
    'PRIORITY': upper_(payload.priority || 'MEDIUM'),
    'ATTACHMENT REQUIRED': payload.attachmentRequired ? 'YES' : 'NO',
    'ATTACHMENT TYPE': payload.attachmentRequired ? 'FILE / PHOTO' : '',
    'VERIFICATION REQUIRED': payload.verificationRequired ? 'YES' : 'NO',
    'VERIFIER': String(payload.verifier || '').trim(),
    'APPROVAL REQUIRED': 'NO',
    'APPROVER': '',
    'BUDDY ALLOWED': payload.buddyAllowed === false ? 'NO' : 'YES',
    'ESCALATION RULE': 'PRIMARY BUDDY > SECONDARY BUDDY > MANAGER',
    'ACTIVE': 'ACTIVE',
    'CREATED BY': String(payload.createdBy || safeCurrentEmail_() || 'WEB APP'),
    'CREATED AT': now,
    'UPDATED AT': now,
    'SOURCE': 'WEB APP',
    'SOURCE KEY': '',
    'SOURCE CONTROL': '',
    'SOURCE APP TASK IDS': '',
    'SOURCE ROW IDS': '',
    'SCHEDULE STATUS': 'READY'
  });

  const checklistLines = String(payload.checklistText || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const checklistSheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES);
  checklistLines.forEach((text, index) => {
    appendObject_(checklistSheet, {
      'CHECKLIST TEMPLATE ID': makeId_('CT'),
      'TASK TEMPLATE ID': templateId,
      'CORE TASK': coreTask,
      'CHECKLIST SEQUENCE': index + 1,
      'CHECKLIST ITEM': text,
      'MANDATORY': 'YES',
      'EVIDENCE REQUIRED': 'NO',
      'EVIDENCE TYPE': '',
      'ACTIVE': 'ACTIVE',
      'CREATED AT': now,
      'UPDATED AT': now
    });
  });

  if (templateAppliesOnDate_({
    'FREQUENCY': frequency,
    'TASK START DATE': startDate,
    'TASK END DATE': String(payload.endDate || '').trim(),
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '',
    'SPECIFIC DATE': specificDate,
    'FREQUENCY DETAIL': frequencyDetail
  }, todayKey_())) {
    generateTasksForDate_(todayKey_(), templateId);
  }

  audit_({ action: 'TASK TEMPLATE CREATED', userName: payload.createdBy || safeCurrentEmail_(), newValue: `${templateId} | ${coreTask}` });
  return { success: true, templateId, message: 'Task added successfully.' };
}

function listTaskTemplates() {
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
  const checklistCounts = {};
  readObjects_(getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES)).forEach(function(c) {
    const id = String(c['TASK TEMPLATE ID'] || '');
    if (!id || upper_(c['ACTIVE'] || 'ACTIVE') === 'INACTIVE') return;
    checklistCounts[id] = (checklistCounts[id] || 0) + 1;
  });

  return rows
    .filter(function(r) { return String(r['TASK TEMPLATE ID'] || '').trim(); })
    .map(function(r) {
      const id = String(r['TASK TEMPLATE ID'] || '');
      return {
        templateId: id,
        task: String(r['CORE TASK'] || ''),
        user: String(r['DEFAULT USER'] || ''),
        userId: String(r['DEFAULT USER ID'] || ''),
        department: String(r['DEPARTMENT'] || ''),
        frequency: upper_(r['FREQUENCY'] || ''),
        startDate: dateKey_(r['TASK START DATE']),
        endDate: dateKey_(r['TASK END DATE']),
        startTime: displayTime_(r['START TIME']),
        dueTime: displayTime_(r['DUE TIME']),
        priority: upper_(r['PRIORITY'] || ''),
        active: upper_(r['ACTIVE'] || 'ACTIVE'),
        scheduleStatus: upper_(r['SCHEDULE STATUS'] || (r['TASK START DATE'] ? 'READY' : 'NEEDS START DATE')),
        source: String(r['SOURCE'] || 'WEB APP'),
        control: String(r['SOURCE CONTROL'] || ''),
        checklistCount: checklistCounts[id] || 0
      };
    })
    .sort(function(a,b) { return a.user.localeCompare(b.user) || a.task.localeCompare(b.task); });
}

function setTemplateActive(templateId, active) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const found = findRowById_(sheet, 'TASK TEMPLATE ID', templateId);
  if (!found) throw new Error('Task template not found.');

  if (active) {
    const frequency = upper_(found.obj['FREQUENCY'] || '');
    const requiresStart = ['WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME'].includes(frequency);
    if (requiresStart && !dateKey_(found.obj['TASK START DATE'])) {
      throw new Error('Set the task start date before activating this recurring task.');
    }
  }

  setCellByHeader_(sheet, found.row, 'ACTIVE', active ? 'ACTIVE' : 'INACTIVE');
  setCellByHeader_(sheet, found.row, 'SCHEDULE STATUS', active ? 'READY' : 'PAUSED');
  setCellByHeader_(sheet, found.row, 'UPDATED AT', nowStamp_());
  return { success: true };
}

function updateTemplateSchedule(payload) {
  payload = payload || {};
  const templateId = String(payload.templateId || '').trim();
  const startDate = String(payload.startDate || '').trim();
  const endDate = String(payload.endDate || '').trim();

  if (!templateId) throw new Error('Task template ID is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Please enter a valid start date.');
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Please enter a valid end date.');
  if (endDate && endDate < startDate) throw new Error('End date cannot be before start date.');

  const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const found = findRowById_(sheet, 'TASK TEMPLATE ID', templateId);
  if (!found) throw new Error('Task template not found.');

  const frequency = upper_(found.obj['FREQUENCY'] || 'DAILY');
  const weekday = weekdayName_(startDate);
  let detail = '';
  let specificDate = '';
  if (frequency === 'WEEKLY') detail = weekday;
  if (frequency === 'MONTHLY') detail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY') detail = startDate.slice(5);
  if (frequency === 'YEARLY') detail = startDate.slice(5);
  if (frequency === 'ONE TIME' || frequency === 'AS REQUIRED') specificDate = startDate;
 
  setObjectByRow_(sheet, found.row, {
    'TASK START DATE': startDate,
    'TASK END DATE': endDate,
    'FREQUENCY DETAIL': detail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '',
    'SPECIFIC DATE': specificDate,
    'ACTIVE': 'ACTIVE',
    'SCHEDULE STATUS': 'READY',
    'UPDATED AT': nowStamp_()
  });

  if (templateAppliesOnDate_(Object.assign({}, found.obj, {
    'TASK START DATE': startDate,
    'TASK END DATE': endDate,
    'FREQUENCY DETAIL': detail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '',
    'SPECIFIC DATE': specificDate
  }), todayKey_())) {
    generateTasksForDate_(todayKey_(), templateId);
  }

  return { success: true };
}

function startTask(taskId, userName) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(sheet, 'TASK INSTANCE ID', taskId);
  if (!found) throw new Error('Task not found.');

  const oldStatus = upper_(found.obj['STATUS'] || 'PENDING');
  if (['COMPLETED','COMPLETED LATE','AWAITING VERIFICATION'].includes(oldStatus)) throw new Error('This task has already been completed.');

  setCellByHeader_(sheet, found.row, 'STATUS', 'IN PROGRESS');
  if (!found.obj['ACTUAL START TIME']) setCellByHeader_(sheet, found.row, 'ACTUAL START TIME', nowStamp_());
  setCellByHeader_(sheet, found.row, 'UPDATED AT', nowStamp_());
  audit_({ taskId, userName, action: 'TASK STARTED', previousValue: oldStatus, newValue: 'IN PROGRESS' });
  return { success: true };
}

function completeTask(taskId, userName, remark) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(sheet, 'TASK INSTANCE ID', taskId);
  if (!found) throw new Error('Task not found.');

  const task = found.obj;
  const checklistRows = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS))
    .filter(c => String(c['TASK INSTANCE ID'] || '') === String(taskId));
  const mandatoryPending = checklistRows.filter(c => yes_(c['MANDATORY']) && upper_(c['STATUS']) !== 'COMPLETED');
  if (mandatoryPending.length) throw new Error(`Complete all mandatory checklist items first (${mandatoryPending.length} pending).`);

  if (yes_(task['ATTACHMENT REQUIRED']) && Number(task['ATTACHMENT COUNT'] || 0) < 1) {
    throw new Error('Evidence attachment is required before completing this task.');
  }

  const delay = delayMinutes_(dateKey_(task['TASK DATE']), task['DUE TIME'], new Date());
  const isLate = delay > 0;
  const verificationRequired = yes_(task['VERIFICATION REQUIRED']);
  const newStatus = verificationRequired ? 'AWAITING VERIFICATION' : (isLate ? 'COMPLETED LATE' : 'COMPLETED');

  setCellByHeader_(sheet, found.row, 'ACTUAL COMPLETION TIME', nowStamp_());
  setCellByHeader_(sheet, found.row, 'STATUS', newStatus);
  setCellByHeader_(sheet, found.row, 'ON TIME / DELAYED', isLate ? 'DELAYED' : 'ON TIME');
  setCellByHeader_(sheet, found.row, 'DELAY MINUTES', delay);
  setCellByHeader_(sheet, found.row, 'REMARK', String(remark || '').trim());
  if (verificationRequired) setCellByHeader_(sheet, found.row, 'VERIFICATION STATUS', 'PENDING');
  setCellByHeader_(sheet, found.row, 'UPDATED AT', nowStamp_());

  if (verificationRequired) createVerificationRecord_(taskId, found.row, task);
  audit_({ taskId, userName, action: 'TASK COMPLETED', previousValue: upper_(task['STATUS']), newValue: newStatus });
  return { success: true, status: newStatus, delayMinutes: delay };
}

function setChecklistStatus(payload) {
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const checklistId = String(payload.checklistId || '').trim();
  const completed = !!payload.completed;
  const userName = String(payload.userName || '').trim();

  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
  const found = findRowById_(sheet, 'CHECKLIST INSTANCE ID', checklistId);
  if (!found || String(found.obj['TASK INSTANCE ID'] || '') !== taskId) throw new Error('Checklist item not found.');

  setCellByHeader_(sheet, found.row, 'STATUS', completed ? 'COMPLETED' : 'PENDING');
  setCellByHeader_(sheet, found.row, 'COMPLETED BY', completed ? userName : '');
  setCellByHeader_(sheet, found.row, 'COMPLETED AT', completed ? nowStamp_() : '');
  setCellByHeader_(sheet, found.row, 'UPDATED AT', nowStamp_());
  updateTaskChecklistProgress_(taskId);
  audit_({ taskId, checklistId, userName, action: 'CHECKLIST UPDATED', previousValue: upper_(found.obj['STATUS']), newValue: completed ? 'COMPLETED' : 'PENDING' });
  return { success: true };
}

function uploadTaskEvidence(payload) {
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  if (!taskId) throw new Error('Task ID is required.');
  if (!payload.fileName || !payload.base64) throw new Error('Please select a file.');

  const taskSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(taskSheet, 'TASK INSTANCE ID', taskId);
  if (!found) throw new Error('Task not found.');

  const bytes = Utilities.base64Decode(String(payload.base64));
  if (bytes.length > 7 * 1024 * 1024) throw new Error('Please upload a file smaller than 7 MB.');

  const folder = getEvidenceFolder_();
  const safeName = `${taskId}_${Utilities.formatDate(new Date(), APP_CONFIG.TZ, 'yyyyMMdd_HHmmss')}_${sanitizeFileName_(payload.fileName)}`;
  const blob = Utilities.newBlob(bytes, String(payload.mimeType || 'application/octet-stream'), safeName);
  const file = folder.createFile(blob);

  appendObject_(getSheet_(APP_CONFIG.SHEETS.ATTACHMENTS), {
    'ATTACHMENT ID': makeId_('ATT'),
    'TASK INSTANCE ID': taskId,
    'CHECKLIST INSTANCE ID': String(payload.checklistId || ''),
    'TASK TEMPLATE ID': String(found.obj['TASK TEMPLATE ID'] || ''),
    'FILE NAME': safeName,
    'FILE TYPE': String(payload.mimeType || ''),
    'FILE URL': file.getUrl(),
    'DRIVE FILE ID': file.getId(),
    'EVIDENCE TYPE': String(payload.evidenceType || 'TASK EVIDENCE'),
    'UPLOADED BY': String(payload.userName || ''),
    'UPLOADED BY USER ID': String(payload.userId || ''),
    'UPLOADED DATE': todayKey_(),
    'UPLOADED TIME': nowTime_(),
    'CREATED AT': nowStamp_()
  });

  const newCount = Number(found.obj['ATTACHMENT COUNT'] || 0) + 1;
  setCellByHeader_(taskSheet, found.row, 'ATTACHMENT COUNT', newCount);
  setCellByHeader_(taskSheet, found.row, 'UPDATED AT', nowStamp_());

  if (['TASK','UPLOAD'].includes(upper_(found.obj['TASK TYPE'] || 'TASK'))) {
    const delay = delayMinutes_(dateKey_(found.obj['TASK DATE']), found.obj['DUE TIME'], new Date());
    setCellByHeader_(taskSheet, found.row, 'ACTUAL COMPLETION TIME', nowStamp_());
    setCellByHeader_(taskSheet, found.row, 'STATUS', delay > 0 ? 'COMPLETED LATE' : 'COMPLETED');
    setCellByHeader_(taskSheet, found.row, 'ON TIME / DELAYED', delay > 0 ? 'DELAYED' : 'ON TIME');
  }

  audit_({ taskId, userName: payload.userName, action: 'EVIDENCE UPLOADED', newValue: file.getUrl() });
  return { success: true, fileUrl: file.getUrl(), attachmentCount: newCount };
}

function listVerificationTasks(filters) {
  filters = filters || {};
  const verifier = String(filters.verifier || '').trim().toLowerCase();
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS))
    .filter(r => upper_(r['STATUS']) === 'AWAITING VERIFICATION')
    .filter(r => !verifier || String(r['VERIFIER'] || '').trim().toLowerCase() === verifier)
    .map(r => ({
      taskId: String(r['TASK INSTANCE ID'] || ''),
      taskDate: dateKey_(r['TASK DATE']),
      coreTask: String(r['CORE TASK'] || ''),
      performer: String(r['CURRENT ASSIGNEE'] || ''),
      verifier: String(r['VERIFIER'] || ''),
      department: String(r['DEPARTMENT'] || ''),
      completedAt: displayDateTime_(r['ACTUAL COMPLETION TIME'])
    }));
}

function verifyTask(payload) {
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const decision = upper_(payload.decision || 'VERIFIED');
  if (!['VERIFIED','REJECTED'].includes(decision)) throw new Error('Invalid verification decision.');

  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(sheet, 'TASK INSTANCE ID', taskId);
  if (!found) throw new Error('Task not found.');
  if (upper_(found.obj['STATUS']) !== 'AWAITING VERIFICATION') throw new Error('Task is not awaiting verification.');

  if (decision === 'VERIFIED') {
    const late = upper_(found.obj['ON TIME / DELAYED']) === 'DELAYED';
    setCellByHeader_(sheet, found.row, 'STATUS', late ? 'COMPLETED LATE' : 'COMPLETED');
    setCellByHeader_(sheet, found.row, 'VERIFICATION STATUS', 'VERIFIED');
  } else {
    setCellByHeader_(sheet, found.row, 'STATUS', 'REJECTED');
    setCellByHeader_(sheet, found.row, 'VERIFICATION STATUS', 'REJECTED');
  }
  setCellByHeader_(sheet, found.row, 'UPDATED AT', nowStamp_());

  updateVerificationRecord_(taskId, decision, payload.remark || '', payload.userName || '');
  audit_({ taskId, userName: payload.userName, action: 'TASK VERIFICATION', previousValue: 'AWAITING VERIFICATION', newValue: decision });
  return { success: true };
}

function addUser(payload) {
  payload = payload || {};
  const name = String(payload.name || '').trim();
  const department = String(payload.department || '').trim();
  if (!name) throw new Error('Employee name is required.');
  if (!department) throw new Error('Department is required.');

  const sheet = getSheet_(APP_CONFIG.SHEETS.USERS);
  const rows = readObjects_(sheet);
  const email = String(payload.email || '').trim().toLowerCase();
  const duplicate = rows.find(r =>
    (email && String(r['EMAIL ADDRESS'] || '').trim().toLowerCase() === email) ||
    String(r['EMPLOYEE NAME'] || '').trim().toLowerCase() === name.toLowerCase()
  );
  if (duplicate) throw new Error('This employee already exists in LIVE_USERS.');

  const userId = makeId_('USR');
  appendObject_(sheet, {
    'USER ID': userId,
    'EMPLOYEE NAME': name,
    'EMPLOYEE ID': String(payload.employeeId || '').trim(),
    'DEPARTMENT': department,
    'DESIGNATION': String(payload.designation || '').trim(),
    'REPORTING MANAGER': String(payload.manager || '').trim(),
    'BRANCH / LOCATION': String(payload.branch || '').trim(),
    'STATUS': 'ACTIVE',
    'EMAIL ADDRESS': email,
    'CONTACT NUMBER': String(payload.contact || '').trim(),
    'WEEKLY OFF': String(payload.weeklyOff || '').trim(),
    'PRIMARY BUDDY': String(payload.primaryBuddy || '').trim(),
    'SECONDARY BUDDY': String(payload.secondaryBuddy || '').trim(),
    'USER ACCESS': String(payload.userAccess || 'USER').trim(),
    'ROLE': String(payload.role || 'EMPLOYEE').trim(),
    'CURRENT AVAILABILITY': 'WORKING',
    'ACTIVE': 'ACTIVE',
    'CREATED AT': nowStamp_(),
    'UPDATED AT': nowStamp_()
  });

  return { success: true, userId };
}

function generateTodayTasks() {
  return generateTasksForDate_(todayKey_(), '');
}

function dailyTaskMaintenance() {
  markOverdueTasks_();
  archiveOldCompletedTasks_();
  const result = generateTasksForDate_(todayKey_(), '');
  rebuildDashboardSummary_(todayKey_());
  return result;
}

function archiveOldCompletedTasks_() {
  const taskSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const checklistSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
  const taskHistory = getSheet_(APP_CONFIG.SHEETS.HISTORY);
  const checklistHistory = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_HISTORY);
  const today = todayKey_();

  const taskData = taskSheet.getDataRange().getValues();
  if (taskData.length < 2) return { archived: 0 };
  const headers = taskData[0].map(String);
  const map = headerMap_(headers);
  const archiveStatuses = new Set(['COMPLETED','COMPLETED LATE','CANCELLED','SKIPPED']);
  const rowsToDelete = [];
  const taskIds = new Set();

  for (let i = 1; i < taskData.length; i++) {
    const obj = rowToObj_(headers, taskData[i]);
    const taskDate = dateKey_(obj['TASK DATE']);
    const status = upper_(obj['STATUS']);
    if (taskDate && taskDate < today && archiveStatuses.has(status)) {
      appendObject_(taskHistory, {
        'TASK INSTANCE ID': obj['TASK INSTANCE ID'],
        'TASK TEMPLATE ID': obj['TASK TEMPLATE ID'],
        'TASK DATE': obj['TASK DATE'],
        'CORE TASK': obj['CORE TASK'],
        'TASK DESCRIPTION': obj['TASK DESCRIPTION'],
        'TASK TYPE': obj['TASK TYPE'],
        'DEPARTMENT': obj['DEPARTMENT'],
        'BRANCH NAME': obj['BRANCH NAME'],
        'ORIGINAL USER ID': obj['ORIGINAL USER ID'],
        'ORIGINAL OWNER': obj['ORIGINAL OWNER'],
        'ACTUAL ASSIGNEE ID': obj['CURRENT ASSIGNEE ID'],
        'ACTUAL ASSIGNEE': obj['CURRENT ASSIGNEE'],
        'ASSIGNMENT TYPE': obj['ASSIGNMENT TYPE'],
        'BUDDY TASK': obj['BUDDY TASK'],
        'PRIORITY': obj['PRIORITY'],
        'SCHEDULED START TIME': obj['SCHEDULED START TIME'],
        'DUE TIME': obj['DUE TIME'],
        'ACTUAL START TIME': obj['ACTUAL START TIME'],
        'ACTUAL COMPLETION TIME': obj['ACTUAL COMPLETION TIME'],
        'FINAL STATUS': obj['STATUS'],
        'CHECKLIST TOTAL': obj['CHECKLIST TOTAL'],
        'CHECKLIST COMPLETED': obj['CHECKLIST COMPLETED'],
        'ATTACHMENT COUNT': obj['ATTACHMENT COUNT'],
        'VERIFICATION STATUS': obj['VERIFICATION STATUS'],
        'APPROVAL STATUS': obj['APPROVAL STATUS'],
        'ON TIME / DELAYED': obj['ON TIME / DELAYED'],
        'DELAY MINUTES': obj['DELAY MINUTES'],
        'REMARK': obj['REMARK'],
        'COMPLETED BY USER ID': obj['COMPLETED BY USER ID'],
        'COMPLETED BY': obj['COMPLETED BY'],
        'COMPLETED BY ROLE': obj['COMPLETED BY ROLE'],
        'COMPLETION MODE': obj['COMPLETION MODE'],
        'CREATED AT': obj['CREATED AT'],
        'COMPLETED AT': obj['ACTUAL COMPLETION TIME'],
        'ARCHIVED AT': nowStamp_()
      });
      rowsToDelete.push(i + 1);
      taskIds.add(String(obj['TASK INSTANCE ID']));
    }
  }

  if (taskIds.size) {
    const cData = checklistSheet.getDataRange().getValues();
    if (cData.length > 1) {
      const cHeaders = cData[0].map(String);
      const cRowsDelete = [];
      for (let i = 1; i < cData.length; i++) {
        const c = rowToObj_(cHeaders, cData[i]);
        if (taskIds.has(String(c['TASK INSTANCE ID'] || ''))) {
          appendObject_(checklistHistory, {
            'TASK INSTANCE ID': c['TASK INSTANCE ID'],
            'CHECKLIST INSTANCE ID': c['CHECKLIST INSTANCE ID'],
            'TASK TEMPLATE ID': c['TASK TEMPLATE ID'],
            'CHECKLIST TEMPLATE ID': c['CHECKLIST TEMPLATE ID'],
            'CORE TASK': c['CORE TASK'],
            'CHECKLIST ITEM': c['CHECKLIST ITEM'],
            'MANDATORY': c['MANDATORY'],
            'STATUS': c['STATUS'],
            'COMPLETED BY': c['COMPLETED BY'],
            'COMPLETED AT': c['COMPLETED AT'],
            'EVIDENCE REQUIRED': c['EVIDENCE REQUIRED'],
            'EVIDENCE COUNT': c['EVIDENCE COUNT'],
            'ARCHIVED AT': nowStamp_()
          });
          cRowsDelete.push(i + 1);
        }
      }
      cRowsDelete.reverse().forEach(r => checklistSheet.deleteRow(r));
    }
  }

  rowsToDelete.reverse().forEach(r => taskSheet.deleteRow(r));
  return { archived: rowsToDelete.length };
}

function rebuildDashboardSummary_(date) {
  const summarySheet = getSheet_(APP_CONFIG.SHEETS.SUMMARY);
  const dash = getDashboardData({ date });
  const existing = readObjects_(summarySheet);
  const foundIndex = existing.findIndex(r => dateKey_(r['SUMMARY DATE']) === date && upper_(r['SUMMARY TYPE']) === 'ORGANIZATION');
  const obj = {
    'SUMMARY DATE': date,
    'SUMMARY TYPE': 'ORGANIZATION',
    'TOTAL TASKS': dash.total,
    'COMPLETED': dash.completed,
    'PENDING': dash.pending,
    'IN PROGRESS': dash.inProgress,
    'OVERDUE': dash.overdue,
    'COMPLETED ON TIME': dash.onTime,
    'COMPLETED LATE': dash.delayed,
    'AWAITING VERIFICATION': dash.awaitingVerification,
    'COMPLETION %': dash.completionPct,
    'ON TIME %': dash.onTimePct,
    'LAST UPDATED': nowStamp_()
  };
  if (foundIndex >= 0) setObjectByRow_(summarySheet, foundIndex + 2, obj);
  else appendObject_(summarySheet, obj);
}


/* ---------------- GENERIC USER MATCHING HELPERS ---------------- */












function findUserByLooseName_(users, name) {
  const key = normalKey_(name);
  if (!key) return null;
  return users.find(function(u) { return normalKey_(u['EMPLOYEE NAME']) === key; }) || null;
}

function normalKey_(value) {
  return String(value == null ? '' : value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableId_(prefix, value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, String(value || ''), Utilities.Charset.UTF_8);
  const hex = bytes.map(function(b) {
    const n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('').slice(0, 12).toUpperCase();
  return String(prefix || 'ID') + '-SRC-' + hex;
}


/* ---------------- GENERATION ENGINE ---------------- */

function ensureTodayGenerated_() {
  const props = PropertiesService.getScriptProperties();
  const today = todayKey_();
  if (props.getProperty('LAST_TASK_GENERATION_DATE') !== today) generateTasksForDate_(today, '');
}

function generateTasksForDate_(date, onlyTemplateId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const templates = readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
    const users = getUsersRaw_();
    const availability = buildAvailabilityMap_(date);
    const liveSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
    const existing = readObjects_(liveSheet);
    const existingIds = new Set(existing.map(r => String(r['TASK INSTANCE ID'] || '')));
    const checklistTemplates = readObjects_(getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES));
    let created = 0;

    templates.forEach(t => {
      const templateId = String(t['TASK TEMPLATE ID'] || '').trim();
      if (!templateId) return;
      if (onlyTemplateId && templateId !== onlyTemplateId) return;
      if (upper_(t['ACTIVE'] || 'ACTIVE') !== 'ACTIVE') return;
      if (!templateAppliesOnDate_(t, date)) return;

      const instanceId = `INST-${templateId}-${date.replace(/-/g,'')}`;
      if (existingIds.has(instanceId)) return;

      const original = findUser_(users, t['DEFAULT USER ID'] || t['DEFAULT USER']);
      if (!original) return;
      const assignment = resolveAssignee_(original, users, availability, t, date);
      const assignee = assignment.user || original;

      const relatedChecklist = checklistTemplates.filter(c =>
        String(c['TASK TEMPLATE ID'] || '') === templateId && upper_(c['ACTIVE'] || 'ACTIVE') !== 'INACTIVE'
      );

      appendObject_(liveSheet, {
        'TASK INSTANCE ID': instanceId,
        'TASK TEMPLATE ID': templateId,
        'TASK DATE': date,
        'CORE TASK': t['CORE TASK'],
        'TASK DESCRIPTION': t['TASK DESCRIPTION'],
        'TASK TYPE': t['TASK TYPE'] || 'CORE TASK',
        'DEPARTMENT': t['DEPARTMENT'] || original['DEPARTMENT'],
        'BRANCH NAME': t['BRANCH NAME'] || original['BRANCH / LOCATION'],
        'ORIGINAL USER ID': original['USER ID'],
        'ORIGINAL OWNER': original['EMPLOYEE NAME'],
        'CURRENT ASSIGNEE ID': assignee['USER ID'],
        'CURRENT ASSIGNEE': assignee['EMPLOYEE NAME'],
        'ASSIGNMENT TYPE': assignment.type,
        'BUDDY TASK': assignment.type === 'ORIGINAL' ? 'NO' : 'YES',
        'ASSIGNED BY': 'SYSTEM',
        'PRIORITY': t['PRIORITY'] || 'MEDIUM',
        'SCHEDULED START TIME': t['START TIME'],
        'DUE TIME': t['DUE TIME'],
        'STATUS': 'PENDING',
        'CHECKLIST TOTAL': relatedChecklist.length,
        'CHECKLIST COMPLETED': 0,
        'CHECKLIST PROGRESS %': 0,
        'ATTACHMENT REQUIRED': 'YES',
        'ATTACHMENT COUNT': 0,
        'VERIFICATION REQUIRED': yes_(t['VERIFICATION REQUIRED']) ? 'YES' : 'NO',
        'VERIFICATION STATUS': yes_(t['VERIFICATION REQUIRED']) ? 'PENDING' : 'NOT REQUIRED',
        'VERIFIER': t['VERIFIER'],
        'APPROVAL REQUIRED': yes_(t['APPROVAL REQUIRED']) ? 'YES' : 'NO',
        'APPROVAL STATUS': yes_(t['APPROVAL REQUIRED']) ? 'PENDING' : 'NOT REQUIRED',
        'APPROVER': t['APPROVER'],
        'CREATED AT': nowStamp_(),
        'UPDATED AT': nowStamp_()
      });

      const checklistSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
      relatedChecklist.forEach(c => {
        appendObject_(checklistSheet, {
          'TASK INSTANCE ID': instanceId,
          'CHECKLIST INSTANCE ID': `CI-${String(c['CHECKLIST TEMPLATE ID'] || makeId_('CT'))}-${date.replace(/-/g,'')}`,
          'TASK TEMPLATE ID': templateId,
          'CHECKLIST TEMPLATE ID': c['CHECKLIST TEMPLATE ID'],
          'CORE TASK': t['CORE TASK'],
          'CHECKLIST SEQUENCE': c['CHECKLIST SEQUENCE'],
          'CHECKLIST ITEM': c['CHECKLIST ITEM'],
          'MANDATORY': yes_(c['MANDATORY']) ? 'YES' : 'NO',
          'STATUS': 'PENDING',
          'EVIDENCE REQUIRED': yes_(c['EVIDENCE REQUIRED']) ? 'YES' : 'NO',
          'EVIDENCE COUNT': 0,
          'CREATED AT': nowStamp_(),
          'UPDATED AT': nowStamp_()
        });
      });

      audit_({ taskId: instanceId, userName: 'SYSTEM', action: 'TASK GENERATED', newValue: String(t['CORE TASK'] || '') });
      existingIds.add(instanceId);
      created++;
    });

    if (!onlyTemplateId && date === todayKey_()) {
      PropertiesService.getScriptProperties().setProperty('LAST_TASK_GENERATION_DATE', date);
    }
    return { success: true, date, created };
  } finally {
    lock.releaseLock();
  }
}

function templateAppliesOnDate_(t, date) {
  const start = dateKey_(t['TASK START DATE']) || dateKey_(t['SPECIFIC DATE']);
  const end = dateKey_(t['TASK END DATE']);
  const frequency = upper_(t['FREQUENCY'] || 'DAILY');

  // Every generated recurring task must have an intentional start date.
  if (!start) return false;
  if (date < start) return false;
  if (end && date > end) return false;

  if (frequency === 'DAILY') return true;

  if (frequency === 'WEEKLY' || frequency === 'SPECIFIC WEEKDAY') {
    const target = upper_(t['SPECIFIC WEEKDAY'] || t['FREQUENCY DETAIL'] || weekdayName_(start));
    return upper_(weekdayName_(date)) === target;
  }

  if (frequency === 'MONTHLY') {
    const day = Number(t['FREQUENCY DETAIL'] || start.slice(8,10));
    return Number(date.slice(8,10)) === day;
  }

  if (frequency === 'QUARTERLY') {
    const sy = Number(start.slice(0,4));
    const sm = Number(start.slice(5,7));
    const sd = Number(start.slice(8,10));
    const y = Number(date.slice(0,4));
    const m = Number(date.slice(5,7));
    const d = Number(date.slice(8,10));
    const monthGap = (y * 12 + m) - (sy * 12 + sm);
    return monthGap >= 0 && monthGap % 3 === 0 && d === sd;
  }

  if (frequency === 'YEARLY') {
    const mmdd = String(t['FREQUENCY DETAIL'] || start.slice(5));
    return date.slice(5) === mmdd;
  }

  if (frequency === 'ONE TIME' || frequency === 'AS REQUIRED' || frequency === 'SPECIFIC DATE') {
    return date === (dateKey_(t['SPECIFIC DATE']) || start);
  }

  if (frequency === 'ALTERNATE DAYS') {
    return dayDiff_(start, date) >= 0 && dayDiff_(start, date) % 2 === 0;
  }

  return false;
}


function resolveAssignee_(original, users, availability, template, date) {
  if (isAvailable_(original, availability, date)) return { user: original, type: 'ORIGINAL' };
  if (!yes_(template['BUDDY ALLOWED'])) return { user: original, type: 'ORIGINAL UNAVAILABLE' };

  const primary = findUser_(users, original['PRIMARY BUDDY']);
  if (primary && isAvailable_(primary, availability, date)) return { user: primary, type: 'PRIMARY BUDDY' };

  const secondary = findUser_(users, original['SECONDARY BUDDY']);
  if (secondary && isAvailable_(secondary, availability, date)) return { user: secondary, type: 'SECONDARY BUDDY' };

  const manager = findUser_(users, original['REPORTING MANAGER']);
  if (manager && isAvailable_(manager, availability, date)) return { user: manager, type: 'ESCALATED TO MANAGER' };

  return { user: original, type: 'UNAVAILABLE - NEED REASSIGNMENT' };
}

function buildAvailabilityMap_(date) {
  const map = {};
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.AVAILABILITY));
  rows.forEach(r => {
    const userId = String(r['USER ID'] || '').trim();
    if (!userId) return;
    const exact = dateKey_(r['DATE']);
    const from = dateKey_(r['FROM DATE']);
    const to = dateKey_(r['TO DATE']);
    if (exact === date || (from && to && date >= from && date <= to)) {
      map[userId] = upper_(r['AVAILABILITY STATUS'] || 'LEAVE');
    }
  });
  return map;
}

function isAvailable_(user, availability, date) {
  if (!user) return false;
  if (upper_(user['ACTIVE'] || 'ACTIVE') === 'INACTIVE') return false;
  if (['INACTIVE','SUSPENDED'].includes(upper_(user['STATUS'] || 'ACTIVE'))) return false;
  const explicit = availability[String(user['USER ID'] || '')];
  if (explicit && explicit !== 'WORKING') return false;
  const current = upper_(user['CURRENT AVAILABILITY'] || 'WORKING');
  if (current && !['WORKING','ACTIVE'].includes(current)) return false;
  const weeklyOff = String(user['WEEKLY OFF'] || '').toUpperCase();
  return !weeklyOff.includes(weekdayName_(date).toUpperCase());
}

/* ---------------- USER + DEPARTMENT HELPERS ---------------- */

function getUsersRaw_() {
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.USERS))
    .filter(r => String(r['EMPLOYEE NAME'] || '').trim());
}

function getUsersForClient_() {
  return getUsersRaw_()
    .filter(r => upper_(r['ACTIVE'] || 'ACTIVE') !== 'INACTIVE' && upper_(r['STATUS'] || 'ACTIVE') !== 'INACTIVE')
    .map(r => ({
      id: String(r['USER ID'] || ''),
      name: String(r['EMPLOYEE NAME'] || ''),
      department: String(r['DEPARTMENT'] || ''),
      designation: String(r['DESIGNATION'] || ''),
      email: String(r['EMAIL ADDRESS'] || ''),
      role: String(r['ROLE'] || r['USER ACCESS'] || 'EMPLOYEE')
    }))
    .sort((a,b) => a.name.localeCompare(b.name));
}

function getDepartmentsForClient_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.DEPARTMENTS);
  const rows = readObjects_(sheet)
    .filter(r => String(r['DEPARTMENT NAME'] || '').trim() && upper_(r['STATUS'] || 'ACTIVE') !== 'INACTIVE')
    .map(r => String(r['DEPARTMENT NAME']).trim());
  if (rows.length) return [...new Set(rows)].sort();
  return [...new Set(getUsersRaw_().map(r => String(r['DEPARTMENT'] || '').trim()).filter(Boolean))].sort();
}

function ensureUserIds_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.USERS);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const headers = values[0].map(String);
  const map = headerMap_(headers);
  const nameCol = map['EMPLOYEE NAME'];
  const idCol = map['USER ID'];
  if (nameCol == null || idCol == null) return;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][nameCol] || '').trim() && !String(values[i][idCol] || '').trim()) {
      sheet.getRange(i + 1, idCol + 1).setValue(makeId_('USR'));
    }
  }
}

function findUser_(users, idOrName) {
  const key = String(idOrName || '').trim().toLowerCase();
  if (!key) return null;
  return users.find(u =>
    String(u['USER ID'] || '').trim().toLowerCase() === key ||
    String(u['EMPLOYEE NAME'] || '').trim().toLowerCase() === key ||
    String(u['EMAIL ADDRESS'] || '').trim().toLowerCase() === key
  ) || null;
}

/* ---------------- VERIFICATION / PROGRESS / OVERDUE ---------------- */

function updateTaskChecklistProgress_(taskId) {
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS)).filter(r => String(r['TASK INSTANCE ID'] || '') === taskId);
  const total = rows.length;
  const completed = rows.filter(r => upper_(r['STATUS']) === 'COMPLETED').length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const taskSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(taskSheet, 'TASK INSTANCE ID', taskId);
  if (!found) return;
  setCellByHeader_(taskSheet, found.row, 'CHECKLIST TOTAL', total);
  setCellByHeader_(taskSheet, found.row, 'CHECKLIST COMPLETED', completed);
  setCellByHeader_(taskSheet, found.row, 'CHECKLIST PROGRESS %', pct);
  setCellByHeader_(taskSheet, found.row, 'UPDATED AT', nowStamp_());
}

function createVerificationRecord_(taskId, row, taskObj) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.VERIFICATION);
  const existing = readObjects_(sheet).some(r => String(r['TASK INSTANCE ID'] || '') === taskId && upper_(r['VERIFICATION STATUS']) === 'PENDING');
  if (existing) return;
  appendObject_(sheet, {
    'VERIFICATION ID': makeId_('VER'),
    'TASK INSTANCE ID': taskId,
    'TASK DATE': taskObj['TASK DATE'],
    'CORE TASK': taskObj['CORE TASK'],
    'PERFORMER': taskObj['CURRENT ASSIGNEE'],
    'VERIFIER': taskObj['VERIFIER'],
    'VERIFICATION STATUS': 'PENDING',
    'CREATED AT': nowStamp_(),
    'UPDATED AT': nowStamp_()
  });
}

function updateVerificationRecord_(taskId, decision, remark, userName) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.VERIFICATION);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].map(String);
  for (let i = data.length - 1; i >= 1; i--) {
    const obj = rowToObj_(headers, data[i]);
    if (String(obj['TASK INSTANCE ID'] || '') === taskId && upper_(obj['VERIFICATION STATUS']) === 'PENDING') {
      setObjectByRow_(sheet, i + 1, {
        'VERIFICATION STATUS': decision,
        'VERIFICATION REMARK': decision === 'VERIFIED' ? String(remark || '') : '',
        'REJECTED REASON': decision === 'REJECTED' ? String(remark || '') : '',
        'VERIFIED AT': nowStamp_(),
        'UPDATED AT': nowStamp_(),
        'VERIFIER': userName || obj['VERIFIER']
      });
      break;
    }
  }
}

function markOverdueTasks_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].map(String);
  const map = headerMap_(headers);
  const today = todayKey_();
  const nowMin = timeToMinutes_(nowTime_());
  const statusCol = map['STATUS'];
  const updatedCol = map['UPDATED AT'];
  if (statusCol == null) return;

  for (let i = 1; i < data.length; i++) {
    const obj = rowToObj_(headers, data[i]);
    const status = upper_(obj['STATUS']);
    if (!['PENDING','IN PROGRESS','REASSIGNED'].includes(status)) continue;
    const taskDate = dateKey_(obj['TASK DATE']);
    const due = timeToMinutes_(obj['DUE TIME']);
    const isOverdue = taskDate < today || (taskDate === today && due >= 0 && nowMin > due);
    if (isOverdue && status !== 'IN PROGRESS') {
      sheet.getRange(i + 1, statusCol + 1).setValue('OVERDUE');
      if (updatedCol != null) sheet.getRange(i + 1, updatedCol + 1).setValue(nowStamp_());
    }
  }
}

/* ---------------- SHEET + GENERIC HELPERS ---------------- */

function getDb_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('DAILY_WORK_DATABASE_ID');
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('Database spreadsheet is not set. Run setDatabaseSpreadsheetId("YOUR_SHEET_ID") once.');
  props.setProperty('DAILY_WORK_DATABASE_ID', active.getId());
  return active;
}

function getSheet_(name) {
  const sheet = getDb_().getSheetByName(name);
  if (!sheet) throw new Error(`Missing sheet: ${name}. Run setupTaskWebApp() once.`);
  return sheet;
}

function ensureSheet_(ss, name, requiredHeaders) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const maxCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, maxCol).getValues()[0].map(v => String(v || '').trim());
  if (headers.every(h => !h)) {
    sheet.getRange(1,1,1,requiredHeaders.length).setValues([requiredHeaders]);
    headers = requiredHeaders.slice();
  } else {
    let last = headers.length;
    requiredHeaders.forEach(h => {
      if (!headers.includes(h)) {
        sheet.getRange(1, ++last).setValue(h);
        headers.push(h);
      }
    });
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1,1,1,headers.length).setFontWeight('bold').setWrap(true);
}

function readObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(v => String(v || '').trim());
  return data.slice(1).filter(row => row.some(v => v !== '' && v != null)).map(row => rowToObj_(headers, row));
}

function rowToObj_(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
  return obj;
}

function headerMap_(headers) {
  const map = {};
  headers.forEach((h,i) => { if (h) map[String(h).trim()] = i; });
  return map;
}

function appendObject_(sheet, obj) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1,1,1,lastCol).getValues()[0].map(v => String(v || '').trim());
  const row = headers.map(h => Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '');
  sheet.appendRow(row);
}

function setObjectByRow_(sheet, rowNumber, obj) {
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
  const map = headerMap_(headers);
  Object.keys(obj).forEach(h => {
    if (map[h] != null) sheet.getRange(rowNumber, map[h] + 1).setValue(obj[h]);
  });
}

function setCellByHeader_(sheet, rowNumber, header, value) {
  const headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
  const idx = headers.indexOf(header);
  if (idx >= 0) sheet.getRange(rowNumber, idx + 1).setValue(value);
}

function findRowById_(sheet, idHeader, idValue) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(v => String(v || '').trim());
  const idx = headers.indexOf(idHeader);
  if (idx < 0) return null;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx] || '') === String(idValue || '')) {
      return { row: i + 1, obj: rowToObj_(headers, data[i]) };
    }
  }
  return null;
}

function getEvidenceFolder_() {
  const root = DriveApp.getFolderById(APP_CONFIG.ROOT_FOLDER_ID);
  const folders = root.getFoldersByName(APP_CONFIG.EVIDENCE_FOLDER_NAME);
  return folders.hasNext() ? folders.next() : root.createFolder(APP_CONFIG.EVIDENCE_FOLDER_NAME);
}

function installDailyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyTaskMaintenance')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('dailyTaskMaintenance')
    .timeBased()
    .atHour(0)
    .nearMinute(5)
    .everyDays(1)
    .inTimezone(APP_CONFIG.TZ)
    .create();
}

function audit_(x) {
  try {
    appendObject_(getSheet_(APP_CONFIG.SHEETS.AUDIT), {
      'AUDIT ID': makeId_('AUD'),
      'TASK INSTANCE ID': String(x.taskId || ''),
      'CHECKLIST INSTANCE ID': String(x.checklistId || ''),
      'USER ID': String(x.userId || ''),
      'USER NAME': String(x.userName || ''),
      'ACTION': String(x.action || ''),
      'FIELD NAME': String(x.fieldName || ''),
      'PREVIOUS VALUE': String(x.previousValue || ''),
      'NEW VALUE': String(x.newValue || ''),
      'DATE': todayKey_(),
      'TIME': nowTime_(),
      'TIMESTAMP': nowStamp_()
    });
  } catch (e) {
    console.log('Audit skipped: ' + e.message);
  }
}

/* ---------------- DATE / STRING HELPERS ---------------- */

function makeId_(prefix) {
  return `${prefix}-${Utilities.formatDate(new Date(), APP_CONFIG.TZ, 'yyyyMMddHHmmssSSS')}-${Math.floor(Math.random()*900+100)}`;
}

function todayKey_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TZ, 'yyyy-MM-dd');
}

function nowStamp_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TZ, 'yyyy-MM-dd HH:mm:ss');
}

function nowTime_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TZ, 'HH:mm');
}

function safeCurrentEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function upper_(v) { return String(v == null ? '' : v).trim().toUpperCase(); }
function yes_(v) { return ['YES','Y','TRUE','1','REQUIRED'].includes(upper_(v)); }
/** Only two task types exist app-wide: CHECKBOX (single-tap complete) or UPLOAD (single-file-upload complete).
 *  Any legacy/unknown value (e.g. old 'TASK', 'CHECKLIST', 'CORE TASK') safely falls back to CHECKBOX. */
function normalizeTaskType_(v) { return upper_(v) === 'UPLOAD' ? 'UPLOAD' : 'CHECKBOX'; }

function dateKey_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, APP_CONFIG.TZ, 'yyyy-MM-dd');
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d)) return Utilities.formatDate(d, APP_CONFIG.TZ, 'yyyy-MM-dd');
  return '';
}

function displayDateTime_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, APP_CONFIG.TZ, 'dd-MMM-yyyy hh:mm a');
  return String(v);
}

function displayTime_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, APP_CONFIG.TZ, 'hh:mm a');
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  let h = Number(m[1]);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ap}`;
}

function timeToMinutes_(v) {
  if (v == null || v === '') return 99999;
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Number(Utilities.formatDate(v, APP_CONFIG.TZ, 'H')) * 60 + Number(Utilities.formatDate(v, APP_CONFIG.TZ, 'm'));
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const d = new Date(`1970-01-01 ${s}`);
  return isNaN(d) ? 99999 : d.getHours()*60 + d.getMinutes();
}

/** 24-hour "HH:mm" string for binding into an <input type="time"> field.
 *  Sheets TIME-formatted cells come back from Apps Script as JS Date objects (epoch 1899-12-30);
 *  String(dateObj) produces "Sat Dec 30 1899 11:00:00 GMT+..." which <input type="time"> rejects. */
function timeValue24_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, APP_CONFIG.TZ, 'HH:mm');
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return (m[1].length < 2 ? '0' + m[1] : m[1]) + ':' + m[2];
  return '';
}

function weekdayName_(dateKey) {
  const [y,m,d] = String(dateKey).split('-').map(Number);
  if (!y || !m || !d) return '';
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(y, m-1, d, 12, 0, 0).getDay()];
}

function dayDiff_(a, b) {
  const [ay,am,ad] = a.split('-').map(Number);
  const [by,bm,bd] = b.split('-').map(Number);
  return Math.floor((Date.UTC(by,bm-1,bd) - Date.UTC(ay,am-1,ad)) / 86400000);
}

function delayMinutes_(taskDate, dueTime, completionDate) {
  const due = timeToMinutes_(dueTime);
  if (due === 99999) return 0;
  const completionDateKey = Utilities.formatDate(completionDate, APP_CONFIG.TZ, 'yyyy-MM-dd');
  const completionMinutes = Number(Utilities.formatDate(completionDate, APP_CONFIG.TZ, 'H')) * 60 + Number(Utilities.formatDate(completionDate, APP_CONFIG.TZ, 'm'));
  const days = dayDiff_(taskDate, completionDateKey);
  return Math.max(0, days * 1440 + completionMinutes - due);
}

function sanitizeFileName_(name) {
  return String(name || 'file').replace(/[\\/:*?"<>|#%{}~]/g, '_').slice(0, 120);
}

/* =====================================================================
 * RBAC / LOGIN / PROCESS COORDINATOR EXTENSION — 2026-08-20
 * ===================================================================== */

APP_CONFIG.SHEETS.AUTH_USERS = 'AUTH_USERS';
APP_CONFIG.SHEETS.AUTH_SESSIONS = 'AUTH_SESSIONS';
APP_CONFIG.SHEETS.PASSWORD_RESET = 'PASSWORD_RESET';
APP_CONFIG.SHEETS.FOLLOW_UP = 'TASK_FOLLOW_UP_LOG';
APP_CONFIG.SHEETS.NOTIFICATIONS = 'NOTIFICATIONS';
APP_CONFIG.SHEETS.SYSTEM_SETTINGS = 'SYSTEM_SETTINGS';

REQUIRED_HEADERS.AUTH_USERS = [
  'AUTH ID','USER ID','EMAIL','PASSWORD HASH','PASSWORD SALT','ROLE','STATUS',
  'FAILED LOGIN COUNT','LOCKED UNTIL MS','LAST LOGIN AT','PASSWORD UPDATED AT','CREATED AT','UPDATED AT'
];
REQUIRED_HEADERS.AUTH_SESSIONS = [
  'SESSION ID','TOKEN HASH','USER ID','EMAIL','ROLE','CREATED AT','EXPIRES AT MS','LAST SEEN AT','ACTIVE'
];
REQUIRED_HEADERS.PASSWORD_RESET = [
  'RESET ID','USER ID','EMAIL','OTP HASH','CREATED AT','CREATED AT MS','EXPIRES AT MS','USED','ATTEMPT COUNT'
];
REQUIRED_HEADERS.TASK_FOLLOW_UP_LOG = [
  'FOLLOW-UP ID','TASK INSTANCE ID','EMPLOYEE','EMPLOYEE ID','DEPARTMENT','TASK','TASK STATUS','DUE TIME',
  'REMINDER TYPE','REMINDER MESSAGE','FOLLOW-UP REMARK','FOLLOWED UP BY','COORDINATOR USER ID',
  'DATE','TIME','TIMESTAMP','EMAIL STATUS'
];
REQUIRED_HEADERS.NOTIFICATIONS = [
  'NOTIFICATION ID','USER ID','EMPLOYEE NAME','TASK INSTANCE ID','NOTIFICATION TYPE','TITLE','MESSAGE',
  'STATUS','CREATED AT','READ AT','CREATED BY USER ID','CREATED BY'
];
REQUIRED_HEADERS.SYSTEM_SETTINGS = ['SETTING','VALUE','DESCRIPTION','UPDATED AT','UPDATED BY'];

['COMPLETED BY USER ID','COMPLETED BY','COMPLETED BY ROLE','COMPLETION MODE'].forEach(function(h) {
  if (REQUIRED_HEADERS.LIVE_TASKS.indexOf(h) < 0) REQUIRED_HEADERS.LIVE_TASKS.push(h);
  if (REQUIRED_HEADERS.TASK_HISTORY.indexOf(h) < 0) REQUIRED_HEADERS.TASK_HISTORY.push(h);
});


function setDatabaseSpreadsheetId(sessionToken, spreadsheetId) {
  const actor = requireSession_(sessionToken);
  requireRoles_(actor, ['SUPER ADMIN']);
  SpreadsheetApp.openById(String(spreadsheetId || '').trim());
  PropertiesService.getScriptProperties().setProperty('DAILY_WORK_DATABASE_ID', String(spreadsheetId || '').trim());
  return setupTaskWebApp();
}

function getPublicBootstrap() {
  return {
    appName: 'Daily Work',
    needsFirstAdmin: authAccountCount_() === 0,
    today: todayKey_(),
    freshMode: true
  };
}

function createFirstSuperAdmin(payload) {
  payload = payload || {};
  if (authAccountCount_() > 0) throw new Error('Initial Super Admin has already been created.');
  const email = normalizeEmail_(payload.email);
  const password = String(payload.password || '');
  const name = String(payload.name || '').trim();
  validateEmail_(email);
  validatePassword_(password);
  if (!name) throw new Error('Please enter the Super Admin name.');

  const usersSheet = getSheet_(APP_CONFIG.SHEETS.USERS);
  let users = getUsersRaw_();
  let user = users.find(function(u) { return normalizeEmail_(u['EMAIL ADDRESS']) === email; });
  let userId;
  if (!user) {
    userId = makeId_('USR');
    appendObject_(usersSheet, {
      'USER ID': userId,
      'EMPLOYEE NAME': name,
      'EMPLOYEE ID': '',
      'DEPARTMENT': String(payload.department || '').trim(),
      'DESIGNATION': 'SUPER ADMIN',
      'STATUS': 'ACTIVE',
      'EMAIL ADDRESS': email,
      'CONTACT NUMBER': String(payload.contact || '').trim(),
      'USER ACCESS': 'ADMIN',
      'ROLE': 'SUPER ADMIN',
      'CURRENT AVAILABILITY': 'WORKING',
      'ACTIVE': 'ACTIVE',
      'CREATED AT': nowStamp_(),
      'UPDATED AT': nowStamp_()
    });
  } else {
    userId = String(user['USER ID'] || '').trim() || makeId_('USR');
    const found = findRowById_(usersSheet, 'USER ID', String(user['USER ID'] || '')) || findUserRowByEmail_(usersSheet, email);
    if (found) setObjectByRow_(usersSheet, found.row, {
      'USER ID': userId,
      'EMPLOYEE NAME': name || user['EMPLOYEE NAME'],
      'ROLE': 'SUPER ADMIN',
      'USER ACCESS': 'ADMIN',
      'STATUS': 'ACTIVE',
      'ACTIVE': 'ACTIVE',
      'UPDATED AT': nowStamp_()
    });
  }
  upsertAuthAccount_(userId, email, 'SUPER ADMIN', password, true);
  audit_({ userId: userId, userName: name, action: 'FIRST SUPER ADMIN CREATED', newValue: email });
  return { success: true, message: 'Super Admin created. You can now log in.' };
}

function login(email, password) {
  email = normalizeEmail_(email);
  password = String(password || '');
  if (!email || !password) throw new Error('Enter email and password.');
  const auth = findAuthByEmail_(email);
  if (!auth) throw new Error('Invalid email or password.');
  if (upper_(auth.obj['STATUS'] || 'ACTIVE') !== 'ACTIVE') throw new Error('This login is inactive. Contact Admin.');

  const lockedUntil = Number(auth.obj['LOCKED UNTIL MS'] || 0);
  if (lockedUntil && Date.now() < lockedUntil) throw new Error('Too many failed attempts. Try again later.');

  const expected = String(auth.obj['PASSWORD HASH'] || '');
  const actual = hashPassword_(password, String(auth.obj['PASSWORD SALT'] || ''));
  if (!constantTimeEquals_(expected, actual)) {
    const failed = Number(auth.obj['FAILED LOGIN COUNT'] || 0) + 1;
    const patch = { 'FAILED LOGIN COUNT': failed, 'UPDATED AT': nowStamp_() };
    if (failed >= 5) {
      patch['LOCKED UNTIL MS'] = Date.now() + 15 * 60 * 1000;
      patch['FAILED LOGIN COUNT'] = 0;
    }
    setObjectByRow_(getSheet_(APP_CONFIG.SHEETS.AUTH_USERS), auth.row, patch);
    throw new Error('Invalid email or password.');
  }

  const user = findUserByIdRaw_(String(auth.obj['USER ID'] || ''));
  if (!user || upper_(user['ACTIVE'] || 'ACTIVE') === 'INACTIVE' || upper_(user['STATUS'] || 'ACTIVE') === 'INACTIVE') {
    throw new Error('User account is inactive. Contact Admin.');
  }

  setObjectByRow_(getSheet_(APP_CONFIG.SHEETS.AUTH_USERS), auth.row, {
    'FAILED LOGIN COUNT': 0,
    'LOCKED UNTIL MS': '',
    'LAST LOGIN AT': nowStamp_(),
    'ROLE': normalizeRole_(user['ROLE'] || auth.obj['ROLE']),
    'UPDATED AT': nowStamp_()
  });
  invalidateExpiredSessions_();
  const token = createSession_(String(user['USER ID'] || ''), email, normalizeRole_(user['ROLE'] || auth.obj['ROLE']));
  return { success: true, token: token, user: userForClient_(user) };
}

function logout(sessionToken) {
  const tokenHash = hashToken_(String(sessionToken || ''));
  const sheet = getSheet_(APP_CONFIG.SHEETS.AUTH_SESSIONS);
  const rows = readObjects_(sheet);
  rows.forEach(function(r, i) {
    if (String(r['TOKEN HASH'] || '') === tokenHash && upper_(r['ACTIVE'] || '') === 'YES') {
      setObjectByRow_(sheet, i + 2, { 'ACTIVE': 'NO', 'LAST SEEN AT': nowStamp_() });
    }
  });
  return { success: true };
}

function getSessionBootstrap(sessionToken) {
  ensureTodayGenerated_();
  markOverdueTasks_();
  const actor = requireSession_(sessionToken);
  const usersRaw = getUsersRaw_();
  const actorUser = findUserByIdRaw_(actor.userId);
  if (!actorUser) throw new Error('Your LIVE_USERS record was not found.');

  let users = [];
  if (canViewAllTasks_(actor)) users = usersRaw.filter(activeUserFilter_).map(userForClient_);
  else users = [userForClient_(actorUser)];

  return {
    today: todayKey_(),
    actor: userForClient_(actorUser),
    role: actor.role,
    permissions: permissionMap_(actor),
    users: users,
    departments: getDepartmentsForClient_(),
    dashboard: getDashboardData(sessionToken, { date: todayKey_() }),
    notificationUnread: countUnreadNotifications_(actor.userId)
  };
}

function getAppBootstrap(sessionToken) {
  return getSessionBootstrap(sessionToken);
}

function getDashboardData(sessionToken, filters) {
  const actor = requireSession_(sessionToken);
  filters = filters || {};
  const date = String(filters.date || todayKey_());
  const requestedUserId = String(filters.userId || '').trim();
  const department = String(filters.department || '').trim();
  let rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS));
  rows = rows.filter(function(r) { return dateKey_(r['TASK DATE']) === date; });

  if (canViewAllTasks_(actor)) {
    if (requestedUserId) rows = rows.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === requestedUserId; });
    if (department) rows = rows.filter(function(r) { return String(r['DEPARTMENT'] || '') === department; });
  } else {
    rows = rows.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId; });
  }

  return buildDashboardMetrics_(rows);
}

function listTasks(sessionToken, filters) {
  const actor = requireSession_(sessionToken);
  filters = filters || {};
  const date = String(filters.date || todayKey_());
  const requestedUserId = String(filters.userId || '').trim();
  const department = String(filters.department || '').trim();
  const branch = String(filters.branch || '').trim();
  const status = upper_(filters.status || '');
  const priority = upper_(filters.priority || '');
  const search = String(filters.search || '').trim().toLowerCase();
  const frequency = upper_(filters.frequency || '');

  let tasks = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS));
  tasks = tasks.filter(function(r) { return dateKey_(r['TASK DATE']) === date; });
  if (canViewAllTasks_(actor)) {
    if (requestedUserId) tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === requestedUserId; });
    if (department) tasks = tasks.filter(function(r) { return String(r['DEPARTMENT'] || '') === department; });
    if (branch) tasks = tasks.filter(function(r) { return String(r['BRANCH NAME'] || '') === branch; });
  } else {
    tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId; });
  }
  if (status) tasks = tasks.filter(function(r) { return upper_(r['STATUS']) === status; });
  if (priority) tasks = tasks.filter(function(r) { return upper_(r['PRIORITY']) === priority; });
  if (frequency) {
    const templateMap = {};
    readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES)).forEach(function(t) { templateMap[String(t['TASK TEMPLATE ID'] || '')] = upper_(t['FREQUENCY']); });
    tasks = tasks.filter(function(r) { return templateMap[String(r['TASK TEMPLATE ID'] || '')] === frequency; });
  }
  if (search) tasks = tasks.filter(function(r) {
    return [r['CORE TASK'],r['TASK DESCRIPTION'],r['ORIGINAL OWNER'],r['CURRENT ASSIGNEE'],r['DEPARTMENT'],r['BRANCH NAME']].join(' ').toLowerCase().indexOf(search) >= 0;
  });
  return taskObjectsForClient_(tasks, actor);
}

function addNewTask(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  payload = payload || {};
  const userId = String(payload.userId || '').trim();
  const coreTask = String(payload.coreTask || '').trim();
  const frequency = upper_(payload.frequency || 'DAILY');
  const startDate = String(payload.startDate || '').trim();
  if (!userId) throw new Error('Please select a user.');
  if (!coreTask) throw new Error('Please enter the task name.');
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Please select a valid task start date.');
  if (['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME','AS REQUIRED'].indexOf(frequency) < 0) throw new Error('Invalid task frequency.');
  const user = findUserByIdRaw_(userId);
  if (!user) throw new Error('Selected user was not found.');

  const templateId = makeId_('TPL');
  const now = nowStamp_();
  const weekday = weekdayName_(startDate);
  const specificDate = ['ONE TIME','AS REQUIRED'].indexOf(frequency) >= 0 ? startDate : '';
  let detail = '';
  if (frequency === 'WEEKLY') detail = weekday;
  if (frequency === 'MONTHLY') detail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY' || frequency === 'YEARLY') detail = startDate.slice(5);

  appendObject_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES), {
    'TASK TEMPLATE ID': templateId,
    'CORE TASK': coreTask,
    'TASK DESCRIPTION': String(payload.description || '').trim(),
    'DEPARTMENT': String(payload.department || user['DEPARTMENT'] || '').trim(),
    'BRANCH NAME': String(user['BRANCH / LOCATION'] || '').trim(),
    'DESIGNATION / ROLE': String(user['DESIGNATION'] || '').trim(),
    'DEFAULT USER': String(user['EMPLOYEE NAME'] || '').trim(),
    'DEFAULT USER ID': userId,
    'TASK TYPE': normalizeTaskType_(payload.workType),
    'FREQUENCY': frequency,
    'FREQUENCY DETAIL': detail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '',
    'SPECIFIC DATE': specificDate,
    'TASK START DATE': startDate,
    'TASK END DATE': String(payload.endDate || '').trim(),
    'START TIME': String(payload.startTime || '').trim(),
    'DUE TIME': String(payload.dueTime || '').trim(),
    'PRIORITY': upper_(payload.priority || 'MEDIUM'),
    'ATTACHMENT REQUIRED': 'YES',
    'ATTACHMENT TYPE': 'FILE / PHOTO',
    'VERIFICATION REQUIRED': payload.verificationRequired ? 'YES' : 'NO',
    'VERIFIER': String(payload.verifier || '').trim(),
    'APPROVAL REQUIRED': 'NO',
    'APPROVER': '',
    'BUDDY ALLOWED': payload.buddyAllowed === false ? 'NO' : 'YES',
    'ESCALATION RULE': 'PRIMARY BUDDY > SECONDARY BUDDY > MANAGER',
    'ACTIVE': 'ACTIVE',
    'CREATED BY': actor.name + ' (' + actor.role + ')',
    'CREATED AT': now,
    'UPDATED AT': now,
    'SOURCE': 'WEB APP',
    'SCHEDULE STATUS': 'READY'
  });

  const checklistLines = String(payload.checklistText || '').split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
  const checklistSheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES);
  checklistLines.forEach(function(text, index) {
    appendObject_(checklistSheet, {
      'CHECKLIST TEMPLATE ID': makeId_('CT'),
      'TASK TEMPLATE ID': templateId,
      'CORE TASK': coreTask,
      'CHECKLIST SEQUENCE': index + 1,
      'CHECKLIST ITEM': text,
      'MANDATORY': 'YES',
      'EVIDENCE REQUIRED': 'NO',
      'ACTIVE': 'ACTIVE',
      'CREATED AT': now,
      'UPDATED AT': now,
      'SOURCE': 'WEB APP'
    });
  });

  if (templateAppliesOnDate_({
    'FREQUENCY': frequency,
    'TASK START DATE': startDate,
    'TASK END DATE': String(payload.endDate || '').trim(),
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '',
    'SPECIFIC DATE': specificDate,
    'FREQUENCY DETAIL': detail
  }, todayKey_())) generateTasksForDate_(todayKey_(), templateId);

  auditActor_(actor, { action: 'TASK TEMPLATE CREATED', newValue: templateId + ' | ' + coreTask });
  return { success: true, templateId: templateId, message: 'Task added successfully.' };
}

function listTaskTemplates(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
  const checklistCounts = {};
  readObjects_(getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES)).forEach(function(c) {
    const id = String(c['TASK TEMPLATE ID'] || '');
    if (id && upper_(c['ACTIVE'] || 'ACTIVE') !== 'INACTIVE') checklistCounts[id] = (checklistCounts[id] || 0) + 1;
  });
  return rows.filter(function(r) { return String(r['TASK TEMPLATE ID'] || '').trim(); }).map(function(r) {
    const id = String(r['TASK TEMPLATE ID'] || '');
    return {
      templateId: id, task: String(r['CORE TASK'] || ''), user: String(r['DEFAULT USER'] || ''), userId: String(r['DEFAULT USER ID'] || ''),
      department: String(r['DEPARTMENT'] || ''), frequency: upper_(r['FREQUENCY'] || ''), startDate: dateKey_(r['TASK START DATE']),
      endDate: dateKey_(r['TASK END DATE']), startTime: displayTime_(r['START TIME']), dueTime: displayTime_(r['DUE TIME']),
      priority: upper_(r['PRIORITY'] || ''), active: upper_(r['ACTIVE'] || 'ACTIVE'),
      scheduleStatus: upper_(r['SCHEDULE STATUS'] || (r['TASK START DATE'] ? 'READY' : 'NEEDS START DATE')),
      source: String(r['SOURCE'] || 'WEB APP'), control: String(r['SOURCE CONTROL'] || ''), checklistCount: checklistCounts[id] || 0,
      evidenceRequired: true
    };
  }).sort(function(a,b) { return a.user.localeCompare(b.user) || a.task.localeCompare(b.task); });
}

function setTemplateActive(sessionToken, templateId, active) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  return setTemplateActiveSecure_(templateId, active, actor);
}

function updateTemplateSchedule(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  payload = payload || {};
  const templateId = String(payload.templateId || '').trim();
  const startDate = String(payload.startDate || '').trim();
  const endDate = String(payload.endDate || '').trim();
  if (!templateId) throw new Error('Task template ID is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Please enter a valid start date.');
  if (endDate && !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('Please enter a valid end date.');
  if (endDate && endDate < startDate) throw new Error('End date cannot be before start date.');
  const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const found = findRowById_(sheet, 'TASK TEMPLATE ID', templateId);
  if (!found) throw new Error('Task template not found.');
  const frequency = upper_(found.obj['FREQUENCY'] || 'DAILY');
  const weekday = weekdayName_(startDate);
  let detail = '';
  let specificDate = '';
  if (frequency === 'WEEKLY') detail = weekday;
  if (frequency === 'MONTHLY') detail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY' || frequency === 'YEARLY') detail = startDate.slice(5);
  if (frequency === 'ONE TIME' || frequency === 'AS REQUIRED') specificDate = startDate;
  setObjectByRow_(sheet, found.row, {
    'TASK START DATE': startDate, 'TASK END DATE': endDate, 'FREQUENCY DETAIL': detail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate,
    'ACTIVE': 'ACTIVE', 'SCHEDULE STATUS': 'READY', 'ATTACHMENT REQUIRED': 'YES', 'UPDATED AT': nowStamp_()
  });
  if (templateAppliesOnDate_(Object.assign({}, found.obj, {
    'TASK START DATE': startDate, 'TASK END DATE': endDate, 'FREQUENCY DETAIL': detail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate
  }), todayKey_())) generateTasksForDate_(todayKey_(), templateId);
  auditActor_(actor, { action: 'TASK TEMPLATE SCHEDULE UPDATED', newValue: templateId + ' | ' + startDate });
  return { success: true };
}

function startTask(sessionToken, taskId) {
  const actor = requireSession_(sessionToken);
  const found = requireTaskActionAccess_(actor, String(taskId || ''));
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const oldStatus = upper_(found.obj['STATUS'] || 'PENDING');
  if (['COMPLETED','COMPLETED LATE','AWAITING VERIFICATION'].indexOf(oldStatus) >= 0) throw new Error('This task has already been completed.');
  setCellByHeader_(sheet, found.row, 'STATUS', 'IN PROGRESS');
  if (!found.obj['ACTUAL START TIME']) setCellByHeader_(sheet, found.row, 'ACTUAL START TIME', nowStamp_());
  setCellByHeader_(sheet, found.row, 'UPDATED AT', nowStamp_());
  auditActor_(actor, { taskId: taskId, action: actor.userId === String(found.obj['CURRENT ASSIGNEE ID'] || '') ? 'TASK STARTED' : 'TASK STARTED ON BEHALF', previousValue: oldStatus, newValue: 'IN PROGRESS' });
  return { success: true };
}

function completeTask(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const remark = String(payload.remark || '').trim();
  const found = requireTaskActionAccess_(actor, taskId);
  const task = found.obj;
  const own = String(task['CURRENT ASSIGNEE ID'] || '') === actor.userId;
  if (!own && !canViewAllTasks_(actor)) throw new Error('You can only complete your own task.');
  if (!own && !remark) throw new Error('A follow-up/completion remark is required when completing a task on behalf of a user.');

  const checklistRows = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS)).filter(function(c) { return String(c['TASK INSTANCE ID'] || '') === taskId; });
  const mandatoryPending = checklistRows.filter(function(c) { return yes_(c['MANDATORY']) && upper_(c['STATUS']) !== 'COMPLETED'; });
  if (mandatoryPending.length) throw new Error('Complete all mandatory checklist items first (' + mandatoryPending.length + ' pending).');

  if (Number(task['ATTACHMENT COUNT'] || 0) < 1) {
    throw new Error('Evidence is mandatory before completing any task. Upload at least one photo/file first.');
  }

  const delay = delayMinutes_(dateKey_(task['TASK DATE']), task['DUE TIME'], new Date());
  const late = delay > 0;
  const verificationRequired = yes_(task['VERIFICATION REQUIRED']);
  const newStatus = verificationRequired ? 'AWAITING VERIFICATION' : (late ? 'COMPLETED LATE' : 'COMPLETED');
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  setObjectByRow_(sheet, found.row, {
    'ACTUAL COMPLETION TIME': nowStamp_(),
    'STATUS': newStatus,
    'ON TIME / DELAYED': late ? 'DELAYED' : 'ON TIME',
    'DELAY MINUTES': delay,
    'REMARK': remark,
    'VERIFICATION STATUS': verificationRequired ? 'PENDING' : String(task['VERIFICATION STATUS'] || 'NOT REQUIRED'),
    'ATTACHMENT REQUIRED': 'YES',
    'COMPLETED BY USER ID': actor.userId,
    'COMPLETED BY': actor.name,
    'COMPLETED BY ROLE': actor.role,
    'COMPLETION MODE': own ? 'OWN' : 'ON BEHALF',
    'UPDATED AT': nowStamp_()
  });
  if (verificationRequired) createVerificationRecord_(taskId, found.row, task);
  auditActor_(actor, { taskId: taskId, action: own ? 'TASK COMPLETED' : 'TASK COMPLETED ON BEHALF', previousValue: upper_(task['STATUS']), newValue: newStatus + (remark ? ' | ' + remark : '') });
  return { success: true, status: newStatus, delayMinutes: delay, completionMode: own ? 'OWN' : 'ON BEHALF' };
}

function setChecklistStatus(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const checklistId = String(payload.checklistId || '').trim();
  requireTaskActionAccess_(actor, taskId);
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
  const found = findRowById_(sheet, 'CHECKLIST INSTANCE ID', checklistId);
  if (!found || String(found.obj['TASK INSTANCE ID'] || '') !== taskId) throw new Error('Checklist item not found.');
  const completed = !!payload.completed;
  setObjectByRow_(sheet, found.row, {
    'STATUS': completed ? 'COMPLETED' : 'PENDING',
    'COMPLETED BY': completed ? actor.name : '',
    'COMPLETED AT': completed ? nowStamp_() : '',
    'UPDATED AT': nowStamp_()
  });
  updateTaskChecklistProgress_(taskId);
  auditActor_(actor, { taskId: taskId, checklistId: checklistId, action: 'CHECKLIST UPDATED', previousValue: upper_(found.obj['STATUS']), newValue: completed ? 'COMPLETED' : 'PENDING' });
  return { success: true };
}

function uploadTaskEvidence(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  if (!taskId) throw new Error('Task ID is required.');
  requireTaskActionAccess_(actor, taskId);
  if (!payload.fileName || !payload.base64) throw new Error('Please select a file.');
  const taskSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(taskSheet, 'TASK INSTANCE ID', taskId);
  const bytes = Utilities.base64Decode(String(payload.base64));
  if (bytes.length > 7 * 1024 * 1024) throw new Error('Please upload a file smaller than 7 MB.');
  const folder = getEvidenceFolder_();
  const safeName = taskId + '_' + Utilities.formatDate(new Date(), APP_CONFIG.TZ, 'yyyyMMdd_HHmmss') + '_' + sanitizeFileName_(payload.fileName);
  const blob = Utilities.newBlob(bytes, String(payload.mimeType || 'application/octet-stream'), safeName);
  const file = folder.createFile(blob);
  appendObject_(getSheet_(APP_CONFIG.SHEETS.ATTACHMENTS), {
    'ATTACHMENT ID': makeId_('ATT'), 'TASK INSTANCE ID': taskId, 'CHECKLIST INSTANCE ID': String(payload.checklistId || ''),
    'TASK TEMPLATE ID': String(found.obj['TASK TEMPLATE ID'] || ''), 'FILE NAME': safeName, 'FILE TYPE': String(payload.mimeType || ''),
    'FILE URL': file.getUrl(), 'DRIVE FILE ID': file.getId(), 'EVIDENCE TYPE': String(payload.evidenceType || 'TASK EVIDENCE'),
    'UPLOADED BY': actor.name, 'UPLOADED BY USER ID': actor.userId, 'UPLOADED DATE': todayKey_(), 'UPLOADED TIME': nowTime_(), 'CREATED AT': nowStamp_()
  });
  const count = Number(found.obj['ATTACHMENT COUNT'] || 0) + 1;
  setObjectByRow_(taskSheet, found.row, { 'ATTACHMENT COUNT': count, 'ATTACHMENT REQUIRED': 'YES', 'UPDATED AT': nowStamp_() });
  auditActor_(actor, { taskId: taskId, action: 'EVIDENCE UPLOADED', newValue: file.getUrl() });
  return { success: true, fileUrl: file.getUrl(), attachmentCount: count };
}

function listVerificationTasks(sessionToken, filters) {
  const actor = requireSession_(sessionToken);
  filters = filters || {};
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS)).filter(function(r) {
    if (upper_(r['STATUS']) !== 'AWAITING VERIFICATION') return false;
    if (isAdmin_(actor)) return true;
    return normalizeName_(r['VERIFIER']) === normalizeName_(actor.name);
  }).map(function(r) {
    return { taskId: String(r['TASK INSTANCE ID'] || ''), taskDate: dateKey_(r['TASK DATE']), coreTask: String(r['CORE TASK'] || ''), performer: String(r['CURRENT ASSIGNEE'] || ''), verifier: String(r['VERIFIER'] || ''), department: String(r['DEPARTMENT'] || ''), completedAt: displayDateTime_(r['ACTUAL COMPLETION TIME']) };
  });
}

function verifyTask(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const decision = upper_(payload.decision || 'VERIFIED');
  if (['VERIFIED','REJECTED'].indexOf(decision) < 0) throw new Error('Invalid verification decision.');
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(sheet, 'TASK INSTANCE ID', taskId);
  if (!found) throw new Error('Task not found.');
  if (!isAdmin_(actor) && normalizeName_(found.obj['VERIFIER']) !== normalizeName_(actor.name)) throw new Error('You are not the verifier for this task.');
  if (upper_(found.obj['STATUS']) !== 'AWAITING VERIFICATION') throw new Error('Task is not awaiting verification.');
  if (decision === 'VERIFIED') {
    const late = upper_(found.obj['ON TIME / DELAYED']) === 'DELAYED';
    setObjectByRow_(sheet, found.row, { 'STATUS': late ? 'COMPLETED LATE' : 'COMPLETED', 'VERIFICATION STATUS': 'VERIFIED', 'UPDATED AT': nowStamp_() });
  } else {
    if (!String(payload.remark || '').trim()) throw new Error('Rejection reason is required.');
    setObjectByRow_(sheet, found.row, { 'STATUS': 'REJECTED', 'VERIFICATION STATUS': 'REJECTED', 'UPDATED AT': nowStamp_() });
  }
  updateVerificationRecord_(taskId, decision, payload.remark || '', actor.name);
  auditActor_(actor, { taskId: taskId, action: 'TASK VERIFICATION', previousValue: 'AWAITING VERIFICATION', newValue: decision });
  return { success: true };
}



function sendTaskReminder(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  if (!canViewAllTasks_(actor)) throw new Error('Only Process Coordinator/Admin can send task reminders.');
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const remark = String(payload.remark || '').trim();
  if (!taskId) throw new Error('Task ID is required.');
  if (!remark) throw new Error('Please enter a reminder/follow-up remark.');
  const found = findRowById_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS), 'TASK INSTANCE ID', taskId);
  if (!found) throw new Error('Task not found.');
  const task = found.obj;
  const user = findUserByIdRaw_(String(task['CURRENT ASSIGNEE ID'] || ''));
  if (!user) throw new Error('Current assignee user record was not found.');
  const email = normalizeEmail_(user['EMAIL ADDRESS']);
  const subject = 'Pending Task Reminder - ' + String(task['CORE TASK'] || 'Task');
  const message = 'Hello ' + String(user['EMPLOYEE NAME'] || '') + ',\n\n' +
    'This is a reminder for your pending task:\n\n' +
    'Task: ' + String(task['CORE TASK'] || '') + '\n' +
    'Department: ' + String(task['DEPARTMENT'] || '') + '\n' +
    'Task Date: ' + dateKey_(task['TASK DATE']) + '\n' +
    'Due Time: ' + displayTime_(task['DUE TIME']) + '\n' +
    'Current Status: ' + upper_(task['STATUS']) + '\n\n' +
    'Follow-up Remark: ' + remark + '\n\n' +
    'Please complete the task and upload the required evidence before marking it complete.\n\n' +
    'Followed up by: ' + actor.name;
  let emailStatus = 'NO EMAIL';
  if (email) {
    try {
      MailApp.sendEmail({ to: email, subject: subject, body: message, name: 'Daily Work' });
      emailStatus = 'SENT';
    } catch (e) {
      emailStatus = 'FAILED: ' + e.message;
    }
  }
  appendObject_(getSheet_(APP_CONFIG.SHEETS.NOTIFICATIONS), {
    'NOTIFICATION ID': makeId_('NTF'), 'USER ID': String(user['USER ID'] || ''), 'EMPLOYEE NAME': String(user['EMPLOYEE NAME'] || ''),
    'TASK INSTANCE ID': taskId, 'NOTIFICATION TYPE': 'TASK REMINDER', 'TITLE': subject, 'MESSAGE': remark,
    'STATUS': 'UNREAD', 'CREATED AT': nowStamp_(), 'READ AT': '', 'CREATED BY USER ID': actor.userId, 'CREATED BY': actor.name
  });
  appendObject_(getSheet_(APP_CONFIG.SHEETS.FOLLOW_UP), {
    'FOLLOW-UP ID': makeId_('FUP'), 'TASK INSTANCE ID': taskId, 'EMPLOYEE': String(user['EMPLOYEE NAME'] || ''),
    'EMPLOYEE ID': String(user['USER ID'] || ''), 'DEPARTMENT': String(task['DEPARTMENT'] || ''), 'TASK': String(task['CORE TASK'] || ''),
    'TASK STATUS': upper_(task['STATUS']), 'DUE TIME': task['DUE TIME'], 'REMINDER TYPE': 'IN-APP + EMAIL',
    'REMINDER MESSAGE': subject, 'FOLLOW-UP REMARK': remark, 'FOLLOWED UP BY': actor.name, 'COORDINATOR USER ID': actor.userId,
    'DATE': todayKey_(), 'TIME': nowTime_(), 'TIMESTAMP': nowStamp_(), 'EMAIL STATUS': emailStatus
  });
  auditActor_(actor, { taskId: taskId, action: 'TASK REMINDER SENT', newValue: emailStatus + ' | ' + remark });
  return { success: true, emailStatus: emailStatus };
}

function listFollowUpLog(sessionToken, filters) {
  const actor = requireSession_(sessionToken);
  if (!canViewAllTasks_(actor)) throw new Error('Not authorized.');
  filters = filters || {};
  let rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.FOLLOW_UP));
  const userId = String(filters.userId || '').trim();
  const date = String(filters.date || '').trim();
  if (userId) rows = rows.filter(function(r) { return String(r['EMPLOYEE ID'] || '') === userId; });
  if (date) rows = rows.filter(function(r) { return dateKey_(r['DATE']) === date; });
  return rows.slice(-500).reverse().map(function(r) {
    return { id: String(r['FOLLOW-UP ID'] || ''), taskId: String(r['TASK INSTANCE ID'] || ''), employee: String(r['EMPLOYEE'] || ''), department: String(r['DEPARTMENT'] || ''), task: String(r['TASK'] || ''), status: String(r['TASK STATUS'] || ''), remark: String(r['FOLLOW-UP REMARK'] || ''), followedBy: String(r['FOLLOWED UP BY'] || ''), timestamp: String(r['TIMESTAMP'] || ''), emailStatus: String(r['EMAIL STATUS'] || '') };
  });
}

function listNotifications(sessionToken) {
  const actor = requireSession_(sessionToken);
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.NOTIFICATIONS)).filter(function(r) { return String(r['USER ID'] || '') === actor.userId; }).slice(-200).reverse().map(function(r) {
    return { id: String(r['NOTIFICATION ID'] || ''), taskId: String(r['TASK INSTANCE ID'] || ''), type: String(r['NOTIFICATION TYPE'] || ''), title: String(r['TITLE'] || ''), message: String(r['MESSAGE'] || ''), status: upper_(r['STATUS'] || 'UNREAD'), createdAt: String(r['CREATED AT'] || ''), readAt: String(r['READ AT'] || '') };
  });
}

function markNotificationRead(sessionToken, notificationId) {
  const actor = requireSession_(sessionToken);
  const sheet = getSheet_(APP_CONFIG.SHEETS.NOTIFICATIONS);
  const found = findRowById_(sheet, 'NOTIFICATION ID', String(notificationId || ''));
  if (!found || String(found.obj['USER ID'] || '') !== actor.userId) throw new Error('Notification not found.');
  setObjectByRow_(sheet, found.row, { 'STATUS': 'READ', 'READ AT': nowStamp_() });
  return { success: true };
}

function saveUser(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const userId = String(payload.userId || '').trim();
  const name = String(payload.name || '').trim();
  const email = normalizeEmail_(payload.email);
  const role = normalizeRole_(payload.role || 'EMPLOYEE');
  if (!name) throw new Error('Employee name is required.');
  validateEmail_(email);
  enforceRoleAssignment_(actor, role);
  const usersSheet = getSheet_(APP_CONFIG.SHEETS.USERS);
  const rows = readObjects_(usersSheet);
  const dup = rows.find(function(r) { return normalizeEmail_(r['EMAIL ADDRESS']) === email && String(r['USER ID'] || '') !== userId; });
  if (dup) throw new Error('This email is already used by another user.');

  let targetId = userId;
  if (!targetId) {
    if (!String(payload.password || '')) throw new Error('Password is required when creating a new user.');
    validatePassword_(String(payload.password || ''));
    targetId = makeId_('USR');
    appendObject_(usersSheet, buildUserRecord_(targetId, payload, role));
  } else {
    const found = findRowById_(usersSheet, 'USER ID', targetId);
    if (!found) throw new Error('User not found.');
    if (normalizeRole_(found.obj['ROLE']) === 'SUPER ADMIN' && actor.role !== 'SUPER ADMIN') throw new Error('Only Super Admin can edit a Super Admin account.');
    setObjectByRow_(usersSheet, found.row, buildUserRecord_(targetId, payload, role));
  }
  const password = String(payload.password || '');
  upsertAuthAccount_(targetId, email, role, password, !!password);
  auditActor_(actor, { action: userId ? 'USER UPDATED' : 'USER CREATED', newValue: targetId + ' | ' + name + ' | ' + role });
  return { success: true, userId: targetId };
}

function addUser(sessionToken, payload) { return saveUser(sessionToken, payload); }

function listUsersAdmin(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  return getUsersRaw_().map(userForClient_);
}

function resetUserPassword(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const userId = String(payload.userId || '').trim();
  const password = String(payload.password || '');
  validatePassword_(password);
  const user = findUserByIdRaw_(userId);
  if (!user) throw new Error('User not found.');
  if (normalizeRole_(user['ROLE']) === 'SUPER ADMIN' && actor.role !== 'SUPER ADMIN') throw new Error('Only Super Admin can reset a Super Admin password.');
  upsertAuthAccount_(userId, normalizeEmail_(user['EMAIL ADDRESS']), normalizeRole_(user['ROLE']), password, true);
  invalidateUserSessions_(userId);
  auditActor_(actor, { action: 'USER PASSWORD RESET BY ADMIN', newValue: userId + ' | ' + user['EMPLOYEE NAME'] });
  return { success: true };
}

function changeOwnPassword(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const current = String(payload.currentPassword || '');
  const next = String(payload.newPassword || '');
  validatePassword_(next);
  const auth = findAuthByEmail_(actor.email);
  if (!auth || !constantTimeEquals_(String(auth.obj['PASSWORD HASH'] || ''), hashPassword_(current, String(auth.obj['PASSWORD SALT'] || '')))) throw new Error('Current password is incorrect.');
  upsertAuthAccount_(actor.userId, actor.email, actor.role, next, true);
  invalidateUserSessions_(actor.userId, sessionToken);
  auditActor_(actor, { action: 'PASSWORD CHANGED' });
  return { success: true };
}

function requestPasswordReset(email) {
  email = normalizeEmail_(email);
  const auth = findAuthByEmail_(email);
  // Do not reveal whether the email exists.
  if (!auth) return { success: true, message: 'If the email is registered, an OTP has been sent.' };
  const resetSheet = getSheet_(APP_CONFIG.SHEETS.PASSWORD_RESET);
  const recent = readObjects_(resetSheet).filter(function(r) { return normalizeEmail_(r['EMAIL']) === email && Number(r['EXPIRES AT MS'] || 0) > Date.now() && upper_(r['USED'] || 'NO') !== 'YES'; }).pop();
  if (recent && Number(recent['CREATED AT MS'] || 0) && Date.now() - Number(recent['CREATED AT MS']) < 2 * 60 * 1000) {
    throw new Error('Please wait before requesting another OTP.');
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 10 * 60 * 1000;
  appendObject_(resetSheet, {
    'RESET ID': makeId_('RST'), 'USER ID': String(auth.obj['USER ID'] || ''), 'EMAIL': email,
    'OTP HASH': hashOtp_(email, otp), 'CREATED AT': nowStamp_(), 'CREATED AT MS': Date.now(), 'EXPIRES AT MS': expires, 'USED': 'NO', 'ATTEMPT COUNT': 0
  });
  MailApp.sendEmail({ to: email, subject: 'Daily Work Password Reset OTP', body: 'Your Daily Work password reset OTP is ' + otp + '. It is valid for 10 minutes. If you did not request this, ignore this email.', name: 'Daily Work' });
  return { success: true, message: 'If the email is registered, an OTP has been sent.' };
}

function resetPasswordWithOtp(payload) {
  payload = payload || {};
  const email = normalizeEmail_(payload.email);
  const otp = String(payload.otp || '').trim();
  const password = String(payload.newPassword || '');
  validatePassword_(password);
  const sheet = getSheet_(APP_CONFIG.SHEETS.PASSWORD_RESET);
  const rows = readObjects_(sheet);
  let match = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (normalizeEmail_(rows[i]['EMAIL']) === email && upper_(rows[i]['USED'] || 'NO') !== 'YES') { match = { obj: rows[i], row: i + 2 }; break; }
  }
  if (!match || Number(match.obj['EXPIRES AT MS'] || 0) < Date.now()) throw new Error('OTP is invalid or expired.');
  const attempts = Number(match.obj['ATTEMPT COUNT'] || 0);
  if (attempts >= 5) throw new Error('Too many OTP attempts. Request a new OTP.');
  if (!constantTimeEquals_(String(match.obj['OTP HASH'] || ''), hashOtp_(email, otp))) {
    setCellByHeader_(sheet, match.row, 'ATTEMPT COUNT', attempts + 1);
    throw new Error('OTP is invalid or expired.');
  }
  const user = findUserByIdRaw_(String(match.obj['USER ID'] || ''));
  if (!user) throw new Error('User not found.');
  upsertAuthAccount_(String(user['USER ID'] || ''), email, normalizeRole_(user['ROLE']), password, true);
  setCellByHeader_(sheet, match.row, 'USED', 'YES');
  invalidateUserSessions_(String(user['USER ID'] || ''));
  audit_({ userId: String(user['USER ID'] || ''), userName: String(user['EMPLOYEE NAME'] || ''), action: 'PASSWORD RESET BY OTP' });
  return { success: true, message: 'Password reset successfully. Please log in.' };
}

function saveDepartment(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Department name is required.');
  const sheet = getSheet_(APP_CONFIG.SHEETS.DEPARTMENTS);
  const id = String(payload.departmentId || '').trim();
  if (id) {
    const found = findRowById_(sheet, 'DEPARTMENT ID', id);
    if (!found) throw new Error('Department not found.');
    setObjectByRow_(sheet, found.row, { 'DEPARTMENT NAME': name, 'DEPARTMENT HEAD': String(payload.head || '').trim(), 'STATUS': upper_(payload.status || 'ACTIVE'), 'UPDATED AT': nowStamp_() });
  } else {
    appendObject_(sheet, { 'DEPARTMENT ID': makeId_('DPT'), 'DEPARTMENT NAME': name, 'DEPARTMENT HEAD': String(payload.head || '').trim(), 'STATUS': upper_(payload.status || 'ACTIVE'), 'CREATED AT': nowStamp_(), 'UPDATED AT': nowStamp_() });
  }
  auditActor_(actor, { action: 'DEPARTMENT SAVED', newValue: name });
  return { success: true };
}

function listDepartmentsAdmin(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.DEPARTMENTS)).filter(function(r) { return String(r['DEPARTMENT NAME'] || '').trim(); }).map(function(r) { return { id: String(r['DEPARTMENT ID'] || ''), name: String(r['DEPARTMENT NAME'] || ''), head: String(r['DEPARTMENT HEAD'] || ''), status: upper_(r['STATUS'] || 'ACTIVE') }; });
}

function saveLeaveRecord(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const isAdmin = isAdmin_(actor);
  const userId = isAdmin ? String(payload.userId || actor.userId) : actor.userId;
  const user = findUserByIdRaw_(userId);
  if (!user) throw new Error('User not found.');
  const fromDate = String(payload.fromDate || '').trim();
  const toDate = String(payload.toDate || fromDate).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) throw new Error('Valid leave dates are required.');
  if (toDate < fromDate) throw new Error('Leave end date cannot be before start date.');
  appendObject_(getSheet_(APP_CONFIG.SHEETS.AVAILABILITY), {
    'RECORD ID': makeId_('AVL'), 'DATE': fromDate, 'USER ID': userId, 'EMPLOYEE NAME': String(user['EMPLOYEE NAME'] || ''),
    'DEPARTMENT': String(user['DEPARTMENT'] || ''), 'AVAILABILITY STATUS': upper_(payload.status || 'LEAVE'),
    'LEAVE TYPE': String(payload.leaveType || 'LEAVE'), 'FROM DATE': fromDate, 'TO DATE': toDate, 'REASON': String(payload.reason || '').trim(),
    'APPROVAL STATUS': isAdmin ? upper_(payload.approvalStatus || 'APPROVED') : 'PENDING', 'CREATED BY': actor.name, 'CREATED AT': nowStamp_(), 'UPDATED AT': nowStamp_()
  });
  return { success: true };
}

function listLeaveRecords(sessionToken) {
  const actor = requireSession_(sessionToken);
  let rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.AVAILABILITY));
  if (!canViewAllTasks_(actor)) rows = rows.filter(function(r) { return String(r['USER ID'] || '') === actor.userId; });
  return rows.slice(-500).reverse().map(function(r) { return { id: String(r['RECORD ID'] || ''), userId: String(r['USER ID'] || ''), employee: String(r['EMPLOYEE NAME'] || ''), department: String(r['DEPARTMENT'] || ''), status: String(r['AVAILABILITY STATUS'] || ''), leaveType: String(r['LEAVE TYPE'] || ''), fromDate: dateKey_(r['FROM DATE']), toDate: dateKey_(r['TO DATE']), reason: String(r['REASON'] || ''), approval: String(r['APPROVAL STATUS'] || '') }; });
}

function saveHoliday(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const date = String(payload.date || '').trim();
  const name = String(payload.name || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) throw new Error('Holiday date and name are required.');
  appendObject_(getSheet_(APP_CONFIG.SHEETS.HOLIDAYS), { 'HOLIDAY ID': makeId_('HOL'), 'DATE': date, 'HOLIDAY NAME': name, 'BRANCH / LOCATION': String(payload.branch || '').trim(), 'ACTIVE': 'ACTIVE', 'CREATED AT': nowStamp_() });
  auditActor_(actor, { action: 'HOLIDAY ADDED', newValue: date + ' | ' + name });
  return { success: true };
}

function listHolidays(sessionToken) {
  requireSession_(sessionToken);
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.HOLIDAYS)).filter(function(r) { return upper_(r['ACTIVE'] || 'ACTIVE') !== 'INACTIVE'; }).map(function(r) { return { id: String(r['HOLIDAY ID'] || ''), date: dateKey_(r['DATE']), name: String(r['HOLIDAY NAME'] || ''), branch: String(r['BRANCH / LOCATION'] || '') }; });
}

function saveSystemSetting(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const key = upper_(payload.setting || '').replace(/\s+/g, '_');
  if (!key) throw new Error('Setting name is required.');
  upsertSetting_(key, String(payload.value == null ? '' : payload.value), String(payload.description || ''), actor.name);
  return { success: true };
}

function listSystemSettings(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.SYSTEM_SETTINGS)).map(function(r) { return { setting: String(r['SETTING'] || ''), value: String(r['VALUE'] || ''), description: String(r['DESCRIPTION'] || ''), updatedAt: String(r['UPDATED AT'] || ''), updatedBy: String(r['UPDATED BY'] || '') }; });
}

function listAuditLog(sessionToken, filters) {
  const actor = requireSession_(sessionToken);
  filters = filters || {};
  let rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.AUDIT));
  if (!isAdmin_(actor)) rows = rows.filter(function(r) { return String(r['USER ID'] || '') === actor.userId; });
  const search = String(filters.search || '').trim().toLowerCase();
  if (search) rows = rows.filter(function(r) { return [r['USER NAME'],r['ACTION'],r['NEW VALUE'],r['TASK INSTANCE ID']].join(' ').toLowerCase().indexOf(search) >= 0; });
  return rows.slice(-500).reverse().map(function(r) { return { id: String(r['AUDIT ID'] || ''), taskId: String(r['TASK INSTANCE ID'] || ''), user: String(r['USER NAME'] || ''), action: String(r['ACTION'] || ''), previous: String(r['PREVIOUS VALUE'] || ''), next: String(r['NEW VALUE'] || ''), timestamp: String(r['TIMESTAMP'] || '') }; });
}

function generateTodayTasks(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  return generateTasksForDate_(todayKey_(), '');
}

/* ---------------- RBAC HELPERS ---------------- */
function normalizeSpecialRoles_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.USERS);
  readObjects_(sheet).forEach(function(r, i) {
    const designation = upper_(r['DESIGNATION'] || '');
    if (designation.indexOf('PROCESS COORDINATOR') >= 0 && normalizeRole_(r['ROLE']) !== 'SUPER ADMIN') {
      setObjectByRow_(sheet, i + 2, { 'ROLE': 'PROCESS COORDINATOR', 'UPDATED AT': nowStamp_() });
    }
  });
}
function normalizeRole_(v) {
  const r = upper_(v || 'EMPLOYEE');
  if (r === 'SUPER ADMIN') return 'SUPER ADMIN';
  if (r === 'ADMIN') return 'ADMIN';
  if (r === 'PROCESS COORDINATOR' || r === 'PROCESS CO-ORDINATOR') return 'PROCESS COORDINATOR';
  return 'EMPLOYEE';
}
function isAdmin_(actor) { return actor && (actor.role === 'ADMIN' || actor.role === 'SUPER ADMIN'); }
function canViewAllTasks_(actor) { return actor && (actor.role === 'PROCESS COORDINATOR' || actor.role === 'ADMIN' || actor.role === 'SUPER ADMIN'); }
function canManageTasks_(actor) { return canViewAllTasks_(actor); }
function requireAdmin_(actor) { if (!isAdmin_(actor)) throw new Error('Admin access required.'); }
function requireTaskManager_(actor) { if (!canManageTasks_(actor)) throw new Error('Process Coordinator/Admin access required.'); }
function requireRoles_(actor, roles) { if (roles.indexOf(actor.role) < 0) throw new Error('You do not have permission for this action.'); }
function enforceRoleAssignment_(actor, role) { if (role === 'SUPER ADMIN' && actor.role !== 'SUPER ADMIN') throw new Error('Only Super Admin can assign the Super Admin role.'); }
function permissionMap_(actor) { return { viewAllTasks: canViewAllTasks_(actor), manageTasks: canManageTasks_(actor), manageUsers: isAdmin_(actor), manageDepartments: isAdmin_(actor), manageSecurity: isAdmin_(actor), completeOnBehalf: canViewAllTasks_(actor), sendReminders: canViewAllTasks_(actor), manageTemplates: canManageTasks_(actor), manageHolidays: isAdmin_(actor), manageSettings: isAdmin_(actor), viewAudit: isAdmin_(actor) }; }
function activeUserFilter_(u) { return upper_(u['ACTIVE'] || 'ACTIVE') !== 'INACTIVE' && upper_(u['STATUS'] || 'ACTIVE') !== 'INACTIVE'; }
function normalizeEmail_(v) { return String(v || '').trim().toLowerCase(); }
function normalizeName_(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ' '); }
function validateEmail_(email) { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) throw new Error('Please enter a valid email address.'); }
function validatePassword_(p) { if (String(p || '').length < 8) throw new Error('Password must be at least 8 characters.'); }
function bytesHex_(bytes) { return bytes.map(function(b) { const n = b < 0 ? b + 256 : b; return ('0' + n.toString(16)).slice(-2); }).join(''); }
function sha256_(value) { return bytesHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''), Utilities.Charset.UTF_8)); }
function authPepper_() { const props = PropertiesService.getScriptProperties(); let p = props.getProperty('AUTH_PEPPER'); if (!p) { p = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('AUTH_PEPPER', p); } return p; }
function hashPassword_(password, salt) { let h = String(salt || '') + '|' + String(password || '') + '|' + authPepper_(); for (let i = 0; i < 2500; i++) h = sha256_(h + '|' + i); return h; }
function hashToken_(token) { return sha256_('SESSION|' + String(token || '') + '|' + authPepper_()); }
function hashOtp_(email, otp) { return sha256_('OTP|' + normalizeEmail_(email) + '|' + String(otp || '') + '|' + authPepper_()); }
function constantTimeEquals_(a, b) { a = String(a || ''); b = String(b || ''); if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; }
function randomSalt_() { return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); }
function authAccountCount_() { try { return readObjects_(getSheet_(APP_CONFIG.SHEETS.AUTH_USERS)).filter(function(r) { return String(r['USER ID'] || '').trim(); }).length; } catch (e) { return 0; } }
function findAuthByEmail_(email) { const sheet = getSheet_(APP_CONFIG.SHEETS.AUTH_USERS); const rows = readObjects_(sheet); const e = normalizeEmail_(email); for (let i = 0; i < rows.length; i++) if (normalizeEmail_(rows[i]['EMAIL']) === e) return { obj: rows[i], row: i + 2 }; return null; }
function upsertAuthAccount_(userId, email, role, password, replacePassword) { const sheet = getSheet_(APP_CONFIG.SHEETS.AUTH_USERS); const rows = readObjects_(sheet); let found = null; for (let i = 0; i < rows.length; i++) if (String(rows[i]['USER ID'] || '') === String(userId)) { found = { obj: rows[i], row: i + 2 }; break; } if (!found && !replacePassword) return; const patch = { 'USER ID': userId, 'EMAIL': normalizeEmail_(email), 'ROLE': normalizeRole_(role), 'STATUS': 'ACTIVE', 'UPDATED AT': nowStamp_() }; if (replacePassword) { const salt = randomSalt_(); patch['PASSWORD SALT'] = salt; patch['PASSWORD HASH'] = hashPassword_(password, salt); patch['PASSWORD UPDATED AT'] = nowStamp_(); } if (found) setObjectByRow_(sheet, found.row, patch); else appendObject_(sheet, Object.assign({ 'AUTH ID': makeId_('AUTH'), 'FAILED LOGIN COUNT': 0, 'LOCKED UNTIL MS': '', 'CREATED AT': nowStamp_() }, patch)); }
function createSession_(userId, email, role) { const token = Utilities.getUuid() + '.' + Utilities.getUuid() + '.' + Math.random().toString(36).slice(2); const hours = Math.max(1, Number(getSetting_('SESSION_HOURS', '12')) || 12); appendObject_(getSheet_(APP_CONFIG.SHEETS.AUTH_SESSIONS), { 'SESSION ID': makeId_('SES'), 'TOKEN HASH': hashToken_(token), 'USER ID': userId, 'EMAIL': normalizeEmail_(email), 'ROLE': normalizeRole_(role), 'CREATED AT': nowStamp_(), 'EXPIRES AT MS': Date.now() + hours * 60 * 60 * 1000, 'LAST SEEN AT': nowStamp_(), 'ACTIVE': 'YES' }); return token; }
function requireSession_(token) { token = String(token || ''); if (!token) throw new Error('SESSION_REQUIRED'); const hash = hashToken_(token); const sheet = getSheet_(APP_CONFIG.SHEETS.AUTH_SESSIONS); const rows = readObjects_(sheet); for (let i = rows.length - 1; i >= 0; i--) { const r = rows[i]; if (String(r['TOKEN HASH'] || '') === hash && upper_(r['ACTIVE'] || '') === 'YES') { if (Number(r['EXPIRES AT MS'] || 0) < Date.now()) { setCellByHeader_(sheet, i + 2, 'ACTIVE', 'NO'); throw new Error('SESSION_EXPIRED'); } const user = findUserByIdRaw_(String(r['USER ID'] || '')); if (!user || !activeUserFilter_(user)) throw new Error('ACCOUNT_INACTIVE'); const role = normalizeRole_(user['ROLE'] || r['ROLE']); setObjectByRow_(sheet, i + 2, { 'LAST SEEN AT': nowStamp_(), 'ROLE': role }); return { userId: String(user['USER ID'] || ''), email: normalizeEmail_(user['EMAIL ADDRESS'] || r['EMAIL']), role: role, name: String(user['EMPLOYEE NAME'] || ''), department: String(user['DEPARTMENT'] || '') }; } } throw new Error('SESSION_EXPIRED'); }
function invalidateExpiredSessions_() { const sheet = getSheet_(APP_CONFIG.SHEETS.AUTH_SESSIONS); readObjects_(sheet).forEach(function(r, i) { if (upper_(r['ACTIVE'] || '') === 'YES' && Number(r['EXPIRES AT MS'] || 0) < Date.now()) setCellByHeader_(sheet, i + 2, 'ACTIVE', 'NO'); }); }
function invalidateUserSessions_(userId, keepToken) { const keepHash = keepToken ? hashToken_(keepToken) : ''; const sheet = getSheet_(APP_CONFIG.SHEETS.AUTH_SESSIONS); readObjects_(sheet).forEach(function(r, i) { if (String(r['USER ID'] || '') === String(userId) && (!keepHash || String(r['TOKEN HASH'] || '') !== keepHash)) setCellByHeader_(sheet, i + 2, 'ACTIVE', 'NO'); }); }
function findUserByIdRaw_(userId) { return getUsersRaw_().find(function(u) { return String(u['USER ID'] || '') === String(userId || ''); }) || null; }
function findUserRowByEmail_(sheet, email) { const rows = readObjects_(sheet); for (let i = 0; i < rows.length; i++) if (normalizeEmail_(rows[i]['EMAIL ADDRESS']) === normalizeEmail_(email)) return { obj: rows[i], row: i + 2 }; return null; }
function userForClient_(u) { return { id: String(u['USER ID'] || ''), name: String(u['EMPLOYEE NAME'] || ''), employeeId: String(u['EMPLOYEE ID'] || ''), department: String(u['DEPARTMENT'] || ''), designation: String(u['DESIGNATION'] || ''), manager: String(u['REPORTING MANAGER'] || ''), branch: String(u['BRANCH / LOCATION'] || ''), status: upper_(u['STATUS'] || 'ACTIVE'), email: String(u['EMAIL ADDRESS'] || ''), contact: String(u['CONTACT NUMBER'] || ''), weeklyOff: String(u['WEEKLY OFF'] || ''), primaryBuddy: String(u['PRIMARY BUDDY'] || ''), secondaryBuddy: String(u['SECONDARY BUDDY'] || ''), role: normalizeRole_(u['ROLE']), availability: String(u['CURRENT AVAILABILITY'] || ''), active: upper_(u['ACTIVE'] || 'ACTIVE') }; }
function buildUserRecord_(userId, p, role) { return { 'USER ID': userId, 'EMPLOYEE NAME': String(p.name || '').trim(), 'EMPLOYEE ID': String(p.employeeId || '').trim(), 'DEPARTMENT': String(p.department || '').trim(), 'DESIGNATION': String(p.designation || '').trim(), 'REPORTING MANAGER': String(p.manager || '').trim(), 'BRANCH / LOCATION': String(p.branch || '').trim(), 'STATUS': upper_(p.status || 'ACTIVE'), 'EMAIL ADDRESS': normalizeEmail_(p.email), 'CONTACT NUMBER': String(p.contact || '').trim(), 'WEEKLY OFF': String(p.weeklyOff || '').trim(), 'PRIMARY BUDDY': String(p.primaryBuddy || '').trim(), 'SECONDARY BUDDY': String(p.secondaryBuddy || '').trim(), 'USER ACCESS': role === 'EMPLOYEE' ? 'USER' : 'ADMIN', 'ROLE': role, 'CURRENT AVAILABILITY': String(p.availability || 'WORKING'), 'ACTIVE': upper_(p.active || 'ACTIVE'), 'CREATED AT': p.createdAt || nowStamp_(), 'UPDATED AT': nowStamp_() }; }
function requireTaskActionAccess_(actor, taskId) { const found = findRowById_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS), 'TASK INSTANCE ID', taskId); if (!found) throw new Error('Task not found.'); if (!canViewAllTasks_(actor) && String(found.obj['CURRENT ASSIGNEE ID'] || '') !== actor.userId) throw new Error('You can only access your own assigned task.'); return found; }
function taskObjectsForClient_(tasks, actor) { const ids = {}; tasks.forEach(function(t) { ids[String(t['TASK INSTANCE ID'] || '')] = true; }); const grouped = {}; readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS)).forEach(function(c) { const id = String(c['TASK INSTANCE ID'] || ''); if (!ids[id]) return; if (!grouped[id]) grouped[id] = []; grouped[id].push({ checklistInstanceId: String(c['CHECKLIST INSTANCE ID'] || ''), text: String(c['CHECKLIST ITEM'] || ''), mandatory: yes_(c['MANDATORY']), status: upper_(c['STATUS'] || 'PENDING'), completedBy: String(c['COMPLETED BY'] || ''), completedAt: displayDateTime_(c['COMPLETED AT']) }); }); tasks.sort(function(a,b) { return timeToMinutes_(a['DUE TIME']) - timeToMinutes_(b['DUE TIME']); }); return tasks.map(function(r) { const own = String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId; return { taskId: String(r['TASK INSTANCE ID'] || ''), templateId: String(r['TASK TEMPLATE ID'] || ''), taskDate: dateKey_(r['TASK DATE']), coreTask: String(r['CORE TASK'] || ''), description: String(r['TASK DESCRIPTION'] || ''), department: String(r['DEPARTMENT'] || ''), branch: String(r['BRANCH NAME'] || ''), originalOwner: String(r['ORIGINAL OWNER'] || ''), currentAssignee: String(r['CURRENT ASSIGNEE'] || ''), currentAssigneeId: String(r['CURRENT ASSIGNEE ID'] || ''), assignmentType: String(r['ASSIGNMENT TYPE'] || ''), priority: upper_(r['PRIORITY'] || 'MEDIUM'), startTime: displayTime_(r['SCHEDULED START TIME']), dueTime: displayTime_(r['DUE TIME']), status: upper_(r['STATUS'] || 'PENDING'),
     workType: upper_(r['TASK TYPE'] || 'TASK'), checklistTotal: Number(r['CHECKLIST TOTAL'] || 0), checklistCompleted: Number(r['CHECKLIST COMPLETED'] || 0), checklistPct: Number(r['CHECKLIST PROGRESS %'] || 0), attachmentRequired: true, attachmentCount: Number(r['ATTACHMENT COUNT'] || 0), verificationRequired: yes_(r['VERIFICATION REQUIRED']), verificationStatus: upper_(r['VERIFICATION STATUS'] || ''), verifier: String(r['VERIFIER'] || ''), onTimeDelayed: upper_(r['ON TIME / DELAYED'] || ''), delayMinutes: Number(r['DELAY MINUTES'] || 0), remark: String(r['REMARK'] || ''), completedBy: String(r['COMPLETED BY'] || ''), completionMode: String(r['COMPLETION MODE'] || ''), canAct: own || canViewAllTasks_(actor), canCompleteOnBehalf: !own && canViewAllTasks_(actor), checklists: (grouped[String(r['TASK INSTANCE ID'] || '')] || []).sort(function(a,b) { return a.text.localeCompare(b.text); }) }; }); }
function buildDashboardMetrics_(rows) { const completedStatuses = ['COMPLETED','COMPLETED LATE']; const completed = rows.filter(function(r) { return completedStatuses.indexOf(upper_(r['STATUS'])) >= 0; }).length; const inProgress = rows.filter(function(r) { return upper_(r['STATUS']) === 'IN PROGRESS'; }).length; const overdue = rows.filter(function(r) { return upper_(r['STATUS']) === 'OVERDUE'; }).length; const awaitingVerification = rows.filter(function(r) { return upper_(r['STATUS']) === 'AWAITING VERIFICATION'; }).length; const pending = rows.filter(function(r) { return ['PENDING','REASSIGNED'].indexOf(upper_(r['STATUS'])) >= 0; }).length; const onTime = rows.filter(function(r) { return upper_(r['ON TIME / DELAYED']) === 'ON TIME'; }).length; const delayed = rows.filter(function(r) { return upper_(r['ON TIME / DELAYED']) === 'DELAYED'; }).length; const onBehalf = rows.filter(function(r) { return upper_(r['COMPLETION MODE']) === 'ON BEHALF'; }).length; return { total: rows.length, completed: completed, pending: pending, inProgress: inProgress, overdue: overdue, awaitingVerification: awaitingVerification, onTime: onTime, delayed: delayed, completedOnBehalf: onBehalf, completionPct: rows.length ? Math.round(completed / rows.length * 100) : 0, onTimePct: completed ? Math.round(onTime / completed * 100) : 0 }; }
function forceMandatoryEvidenceOnLiveTasks_() { return { success: true, mode: 'PER TEMPLATE' }; }
function auditActor_(actor, x) { x = x || {}; x.userId = actor.userId; x.userName = actor.name + ' [' + actor.role + ']'; audit_(x); }
function countUnreadNotifications_(userId) { return readObjects_(getSheet_(APP_CONFIG.SHEETS.NOTIFICATIONS)).filter(function(r) { return String(r['USER ID'] || '') === userId && upper_(r['STATUS'] || 'UNREAD') === 'UNREAD'; }).length; }
function initializeSystemSettings_() { upsertSetting_('SESSION_HOURS','12','Login session validity in hours','SYSTEM'); upsertSetting_('PASSWORD_MIN_LENGTH','8','Minimum password length','SYSTEM'); upsertSetting_('EVIDENCE_REQUIRED_FOR_COMPLETION','YES','Mandatory system rule','SYSTEM'); }
function upsertSetting_(key, value, description, by) { const sheet = getSheet_(APP_CONFIG.SHEETS.SYSTEM_SETTINGS); const rows = readObjects_(sheet); for (let i = 0; i < rows.length; i++) if (upper_(rows[i]['SETTING']) === upper_(key)) { setObjectByRow_(sheet, i + 2, { 'VALUE': value, 'DESCRIPTION': description || rows[i]['DESCRIPTION'], 'UPDATED AT': nowStamp_(), 'UPDATED BY': by || 'SYSTEM' }); return; } appendObject_(sheet, { 'SETTING': key, 'VALUE': value, 'DESCRIPTION': description, 'UPDATED AT': nowStamp_(), 'UPDATED BY': by || 'SYSTEM' }); }
function getSetting_(key, fallback) { try { const r = readObjects_(getSheet_(APP_CONFIG.SHEETS.SYSTEM_SETTINGS)).find(function(x) { return upper_(x['SETTING']) === upper_(key); }); return r ? String(r['VALUE'] || fallback) : fallback; } catch (e) { return fallback; } }
function setTemplateActiveSecure_(templateId, active, actor) { const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES); const found = findRowById_(sheet, 'TASK TEMPLATE ID', templateId); if (!found) throw new Error('Task template not found.'); if (active) { const frequency = upper_(found.obj['FREQUENCY'] || ''); if (['WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME'].indexOf(frequency) >= 0 && !dateKey_(found.obj['TASK START DATE'])) throw new Error('Set the task start date before activating this recurring task.'); } setObjectByRow_(sheet, found.row, { 'ACTIVE': active ? 'ACTIVE' : 'INACTIVE', 'SCHEDULE STATUS': active ? 'READY' : 'PAUSED', 'ATTACHMENT REQUIRED': 'YES', 'UPDATED AT': nowStamp_() }); auditActor_(actor, { action: active ? 'TASK TEMPLATE ACTIVATED' : 'TASK TEMPLATE DEACTIVATED', newValue: templateId }); return { success: true }; }

/* Copies of source-library functions with authorization handled by wrappers. */

/* =====================================================================
 * FRESH V3 / BULK + BRANCH MASTER EXTENSION — 2026-08-20
 * Browser parses XLSX; server revalidates and imports.
 * ===================================================================== */
APP_CONFIG.SHEETS.BRANCHES = 'BRANCHES';
APP_CONFIG.SHEETS.BULK_IMPORT_LOG = 'BULK_IMPORT_LOG';
APP_CONFIG.SHEETS.BULK_IMPORT_ERRORS = 'BULK_IMPORT_ERRORS';

REQUIRED_HEADERS.BRANCHES = [
  'BRANCH ID','BRANCH NAME','BRANCH CODE','LOCATION','STATUS','CREATED AT','UPDATED AT'
];
REQUIRED_HEADERS.BULK_IMPORT_LOG = [
  'BATCH ID','FILE NAME','IMPORT TYPE','UPLOADED BY USER ID','UPLOADED BY','TIMESTAMP',
  'TOTAL ROWS','VALID ROWS','INVALID ROWS','SUCCESS COUNT','FAILED COUNT','STATUS'
];
REQUIRED_HEADERS.BULK_IMPORT_ERRORS = [
  'BATCH ID','SHEET NAME','ROW NUMBER','RECORD KEY','ERROR MESSAGE','RAW DATA JSON','TIMESTAMP'
];

if (REQUIRED_HEADERS.DEPARTMENTS.indexOf('DEPARTMENT CODE') < 0) {
  REQUIRED_HEADERS.DEPARTMENTS.splice(2, 0, 'DEPARTMENT CODE');
}
if (REQUIRED_HEADERS.TASK_TEMPLATES.indexOf('BRANCH NAME') < 0) {
  REQUIRED_HEADERS.TASK_TEMPLATES.splice(4, 0, 'BRANCH NAME');
}
if (REQUIRED_HEADERS.LIVE_TASKS.indexOf('BRANCH NAME') < 0) {
  REQUIRED_HEADERS.LIVE_TASKS.splice(7, 0, 'BRANCH NAME');
}
if (REQUIRED_HEADERS.TASK_HISTORY.indexOf('BRANCH NAME') < 0) {
  REQUIRED_HEADERS.TASK_HISTORY.splice(7, 0, 'BRANCH NAME');
}

var BULK_V2_TEMPLATE_VERSION = '2026-08-20-FRESH-V5';
var BULK_V2_ALLOWED_FREQUENCIES = ['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME','AS REQUIRED'];
var BULK_V2_ALLOWED_ROLES = ['EMPLOYEE','PROCESS COORDINATOR','ADMIN','SUPER ADMIN'];
var BULK_V2_ALLOWED_PRIORITIES = ['LOW','MEDIUM','HIGH','CRITICAL'];
var BULK_V2_ALLOWED_STATUS = ['ACTIVE','INACTIVE'];
var BULK_V2_MAX_ROWS = 5000;

/** Fresh V3 permissions. Branch/bulk masters are Admin/Super Admin only. */
function permissionMap_(actor) {
  return {
    viewAllTasks: canViewAllTasks_(actor),
    manageTasks: canManageTasks_(actor),
    manageUsers: isAdmin_(actor),
    manageDepartments: isAdmin_(actor),
    manageBranches: isAdmin_(actor),
    manageBulkImport: isAdmin_(actor),
    manageSecurity: isAdmin_(actor),
    completeOnBehalf: canViewAllTasks_(actor),
    sendReminders: canViewAllTasks_(actor),
    manageTemplates: canManageTasks_(actor),
    manageHolidays: isAdmin_(actor),
    manageSettings: isAdmin_(actor),
    viewAudit: isAdmin_(actor)
  };
}

/** Session bootstrap override: returns branch master options as well. */
function getSessionBootstrap(sessionToken) {
  ensureTodayGenerated_();
  markOverdueTasks_();
  const actor = requireSession_(sessionToken);
  const usersRaw = getUsersRaw_();
  const actorUser = findUserByIdRaw_(actor.userId);
  if (!actorUser) throw new Error('Your LIVE_USERS record was not found.');

  let users = [];
  if (canViewAllTasks_(actor)) users = usersRaw.filter(activeUserFilter_).map(userForClient_);
  else users = [userForClient_(actorUser)];

  return {
    today: todayKey_(),
    actor: userForClient_(actorUser),
    role: actor.role,
    permissions: permissionMap_(actor),
    users: users,
    departments: getDepartmentsForClient_(),
    branches: getBranchesForClient_(),
    dashboard: getDashboardData(sessionToken, { date: todayKey_() }),
    notificationUnread: countUnreadNotifications_(actor.userId),
    bulkTemplateVersion: BULK_V2_TEMPLATE_VERSION
  };
}

function getBranchesForClient_() {
  try {
    return readObjects_(getSheet_(APP_CONFIG.SHEETS.BRANCHES))
      .filter(function(r) { return String(r['BRANCH NAME'] || '').trim() && upper_(r['STATUS'] || 'ACTIVE') !== 'INACTIVE'; })
      .map(function(r) { return String(r['BRANCH NAME'] || '').trim(); })
      .sort(function(a,b) { return a.localeCompare(b); });
  } catch (e) {
    return [];
  }
}

function findBranchByName_(name) {
  const key = normalizeName_(name);
  if (!key) return null;
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.BRANCHES));
  for (let i = 0; i < rows.length; i++) {
    if (normalizeName_(rows[i]['BRANCH NAME']) === key) return { obj: rows[i], row: i + 2 };
  }
  return null;
}

function assertBranchExists_(name) {
  const branch = String(name || '').trim();
  if (!branch) throw new Error('Branch name is required.');
  if (!findBranchByName_(branch)) throw new Error('Selected branch was not found in Branch Management.');
  return branch;
}

function listBranchesAdmin(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.BRANCHES))
    .filter(function(r) { return String(r['BRANCH NAME'] || '').trim(); })
    .map(function(r) {
      return {
        id: String(r['BRANCH ID'] || ''),
        name: String(r['BRANCH NAME'] || ''),
        code: String(r['BRANCH CODE'] || ''),
        location: String(r['LOCATION'] || ''),
        status: upper_(r['STATUS'] || 'ACTIVE')
      };
    })
    .sort(function(a,b) { return a.name.localeCompare(b.name); });
}

function saveBranch(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const sheet = getSheet_(APP_CONFIG.SHEETS.BRANCHES);
  const id = String(payload.branchId || '').trim();
  const name = String(payload.name || '').trim();
  const code = String(payload.code || '').trim().toUpperCase();
  const location = String(payload.location || '').trim();
  const status = upper_(payload.status || 'ACTIVE');
  if (!name) throw new Error('Branch name is required.');
  if (BULK_V2_ALLOWED_STATUS.indexOf(status) < 0) throw new Error('Invalid branch status.');

  const rows = readObjects_(sheet);
  const duplicate = rows.find(function(r) {
    const sameName = normalizeName_(r['BRANCH NAME']) === normalizeName_(name);
    const sameCode = code && upper_(r['BRANCH CODE']) === code;
    return (sameName || sameCode) && String(r['BRANCH ID'] || '') !== id;
  });
  if (duplicate) throw new Error('Branch name/code already exists.');

  if (id) {
    const found = findRowById_(sheet, 'BRANCH ID', id);
    if (!found) throw new Error('Branch not found.');
    setObjectByRow_(sheet, found.row, {
      'BRANCH NAME': name,
      'BRANCH CODE': code,
      'LOCATION': location,
      'STATUS': status,
      'UPDATED AT': nowStamp_()
    });
  } else {
    appendObject_(sheet, {
      'BRANCH ID': makeId_('BR'),
      'BRANCH NAME': name,
      'BRANCH CODE': code,
      'LOCATION': location,
      'STATUS': status,
      'CREATED AT': nowStamp_(),
      'UPDATED AT': nowStamp_()
    });
  }
  auditActor_(actor, { action: 'BRANCH SAVED', newValue: name + (code ? ' | ' + code : '') });
  return { success: true };
}

/** Department override adds Department Code while preserving existing behavior. */
function saveDepartment(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const name = String(payload.name || '').trim();
  const code = String(payload.code || '').trim().toUpperCase();
  if (!name) throw new Error('Department name is required.');
  const sheet = getSheet_(APP_CONFIG.SHEETS.DEPARTMENTS);
  const id = String(payload.departmentId || '').trim();
  const rows = readObjects_(sheet);
  const duplicate = rows.find(function(r) {
    const sameName = normalizeName_(r['DEPARTMENT NAME']) === normalizeName_(name);
    const sameCode = code && upper_(r['DEPARTMENT CODE']) === code;
    return (sameName || sameCode) && String(r['DEPARTMENT ID'] || '') !== id;
  });
  if (duplicate) throw new Error('Department name/code already exists.');
  const patch = {
    'DEPARTMENT NAME': name,
    'DEPARTMENT CODE': code,
    'DEPARTMENT HEAD': String(payload.head || '').trim(),
    'STATUS': upper_(payload.status || 'ACTIVE'),
    'UPDATED AT': nowStamp_()
  };
  if (id) {
    const found = findRowById_(sheet, 'DEPARTMENT ID', id);
    if (!found) throw new Error('Department not found.');
    setObjectByRow_(sheet, found.row, patch);
  } else {
    patch['DEPARTMENT ID'] = makeId_('DPT');
    patch['CREATED AT'] = nowStamp_();
    appendObject_(sheet, patch);
  }
  auditActor_(actor, { action: 'DEPARTMENT SAVED', newValue: name + (code ? ' | ' + code : '') });
  return { success: true };
}

function listDepartmentsAdmin(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.DEPARTMENTS))
    .filter(function(r) { return String(r['DEPARTMENT NAME'] || '').trim(); })
    .map(function(r) {
      return {
        id: String(r['DEPARTMENT ID'] || ''),
        name: String(r['DEPARTMENT NAME'] || ''),
        code: String(r['DEPARTMENT CODE'] || ''),
        head: String(r['DEPARTMENT HEAD'] || ''),
        status: upper_(r['STATUS'] || 'ACTIVE')
      };
    })
    .sort(function(a,b) { return a.name.localeCompare(b.name); });
}

/** User override: Branch is mandatory for every newly-created/edited employee account. */
function saveUser(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const userId = String(payload.userId || '').trim();
  const name = String(payload.name || '').trim();
  const email = normalizeEmail_(payload.email);
  const role = normalizeRole_(payload.role || 'EMPLOYEE');
  const branch = String(payload.branch || '').trim();
  if (!name) throw new Error('Employee name is required.');
  validateEmail_(email);
  assertBranchExists_(branch);
  enforceRoleAssignment_(actor, role);
  const usersSheet = getSheet_(APP_CONFIG.SHEETS.USERS);
  const rows = readObjects_(usersSheet);
  const dup = rows.find(function(r) { return normalizeEmail_(r['EMAIL ADDRESS']) === email && String(r['USER ID'] || '') !== userId; });
  if (dup) throw new Error('This email is already used by another user.');

  let targetId = userId;
  payload.branch = branch;
  if (!targetId) {
    if (!String(payload.password || '')) throw new Error('Password is required when creating a new user.');
    validatePassword_(String(payload.password || ''));
    targetId = makeId_('USR');
    appendObject_(usersSheet, buildUserRecord_(targetId, payload, role));
  } else {
    const found = findRowById_(usersSheet, 'USER ID', targetId);
    if (!found) throw new Error('User not found.');
    if (normalizeRole_(found.obj['ROLE']) === 'SUPER ADMIN' && actor.role !== 'SUPER ADMIN') throw new Error('Only Super Admin can edit a Super Admin account.');
    const patch = buildUserRecord_(targetId, payload, role);
    patch['CREATED AT'] = found.obj['CREATED AT'] || nowStamp_();
    setObjectByRow_(usersSheet, found.row, patch);
  }
  const password = String(payload.password || '');
  upsertAuthAccount_(targetId, email, role, password, !!password);
  auditActor_(actor, { action: userId ? 'USER UPDATED' : 'USER CREATED', newValue: targetId + ' | ' + name + ' | ' + branch + ' | ' + role });
  return { success: true, userId: targetId };
}

function addUser(sessionToken, payload) { return saveUser(sessionToken, payload); }

/** Public information used by the Bulk Upload page. */
function getBulkTemplateInfo(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  return {
    version: BULK_V2_TEMPLATE_VERSION,
    fileName: 'Daily_Work_Fresh_V5_Bulk_Upload_Template.xlsx',
    sheets: ['INSTRUCTIONS','BRANCHES','DEPARTMENTS','USERS','TASKS'],
    maxRows: BULK_V2_MAX_ROWS
  };
}

function normalizeBulkHeader_(value) {
  return upper_(String(value || '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' '));
}

function normalizeBulkDataObject_(obj) {
  const out = {};
  Object.keys(obj || {}).forEach(function(k) {
    if (String(k).indexOf('__') === 0) return;
    out[normalizeBulkHeader_(k)] = obj[k];
  });
  return out;
}

function normalizeBulkSheetRows_(rows) {
  return (rows || []).map(function(r, index) {
    return {
      rowNumber: Number(r && r.__ROW_NUMBER || index + 2),
      data: normalizeBulkDataObject_(r || {})
    };
  }).filter(function(r) {
    return Object.keys(r.data).some(function(k) { return String(r.data[k] == null ? '' : r.data[k]).trim() !== ''; });
  });
}

function bulkCell_(data, names) {
  names = Array.isArray(names) ? names : [names];
  for (let i = 0; i < names.length; i++) {
    const key = normalizeBulkHeader_(names[i]);
    if (Object.prototype.hasOwnProperty.call(data || {}, key)) return data[key];
  }
  return '';
}

function normalizeBulkFrequency_(value) {
  let f = upper_(value).replace(/_/g, ' ').replace(/\s+/g, ' ');
  if (f === 'D' || f === 'DAILY') return 'DAILY';
  if (f === 'W' || f === 'WEEKLY') return 'WEEKLY';
  if (f === 'M' || f === 'MONTHLY') return 'MONTHLY';
  if (f === 'Q' || f === 'QUARTERLY') return 'QUARTERLY';
  if (f === 'Y' || f === 'YEARLY' || f === 'ANNUAL' || f === 'ANNUALLY') return 'YEARLY';
  if (f === 'ONE-TIME' || f === 'ONE TIME' || f === 'ONETIME') return 'ONE TIME';
  if (f === 'AS REQUIRED' || f === 'AS-REQUIRED' || f === 'REQUIRED') return 'AS REQUIRED';
  return f;
}

function normalizeBulkDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, APP_CONFIG.TZ, 'yyyy-MM-dd');
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function normalizeBulkTime_(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return s;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ap = upper_(m[3] || '');
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return ('0' + h).slice(-2) + ':' + ('0' + min).slice(-2);
}

function normalizeBulkYesNo_(value, defaultValue) {
  const s = upper_(value);
  if (!s) return defaultValue || 'NO';
  return ['YES','Y','TRUE','1','REQUIRED'].indexOf(s) >= 0 ? 'YES' : 'NO';
}

function buildBulkTaskGroups_(rows) {
  const groups = {};
  (rows || []).forEach(function(r) {
    const d = r.data || {};
    const email = normalizeEmail_(bulkCell_(d, ['EMPLOYEE EMAIL','EMAIL ADDRESS','EMAIL']));
    const name = normalizeName_(bulkCell_(d, ['EMPLOYEE NAME','DOER NAME','USER']));
    const core = String(bulkCell_(d, ['CORE TASK','TASK'] ) || '').trim();
    const frequency = normalizeBulkFrequency_(bulkCell_(d, 'FREQUENCY'));
    const startDate = normalizeBulkDate_(bulkCell_(d, ['TASK START DATE','START DATE']));
    const department = normalizeName_(bulkCell_(d, 'DEPARTMENT'));
    const branch = normalizeName_(bulkCell_(d, ['BRANCH NAME','BRANCH / LOCATION','BRANCH']));
    const key = [email || name, department, branch, normalizeName_(core), frequency, startDate].join('||');
    if (!groups[key]) {
      groups[key] = { key: key, rows: [], checklist: [], first: d, rowNumber: r.rowNumber };
    }
    groups[key].rows.push(r);
    const item = String(bulkCell_(d, ['CHECKLIST ITEM','CHECKLIST / TASK STEP','SUB TASK / CHECKLIST']) || '').trim();
    if (item && groups[key].checklist.indexOf(item) < 0) groups[key].checklist.push(item);
  });
  return Object.keys(groups).map(function(k) { return groups[k]; });
}

function collectBulkPayload_(payload) {
  payload = payload || {};
  const source = payload.sheets || {};
  const result = { BRANCHES: [], DEPARTMENTS: [], USERS: [], TASKS: [] };
  Object.keys(source).forEach(function(k) {
    const name = normalizeBulkHeader_(k).replace(/\s/g, '');
    if (name === 'BRANCHES' || name === 'BRANCH') result.BRANCHES = normalizeBulkSheetRows_(source[k]);
    if (name === 'DEPARTMENTS' || name === 'DEPARTMENT') result.DEPARTMENTS = normalizeBulkSheetRows_(source[k]);
    if (name === 'USERS' || name === 'USER') result.USERS = normalizeBulkSheetRows_(source[k]);
    if (name === 'TASKS' || name === 'TASK') result.TASKS = normalizeBulkSheetRows_(source[k]);
  });
  const total = result.BRANCHES.length + result.DEPARTMENTS.length + result.USERS.length + result.TASKS.length;
  if (total > BULK_V2_MAX_ROWS) throw new Error('Bulk upload supports maximum ' + BULK_V2_MAX_ROWS + ' data rows per file.');
  return result;
}

function bulkExistingContext_() {
  const branches = {};
  try {
    readObjects_(getSheet_(APP_CONFIG.SHEETS.BRANCHES)).forEach(function(r) {
      const n = normalizeName_(r['BRANCH NAME']); if (n) branches[n] = r;
    });
  } catch (e) {}
  const departments = {};
  try {
    readObjects_(getSheet_(APP_CONFIG.SHEETS.DEPARTMENTS)).forEach(function(r) {
      const n = normalizeName_(r['DEPARTMENT NAME']); if (n) departments[n] = r;
    });
  } catch (e) {}
  const usersByEmail = {}, usersByName = {};
  getUsersRaw_().forEach(function(u) {
    const e = normalizeEmail_(u['EMAIL ADDRESS']); if (e) usersByEmail[e] = u;
    const n = normalizeName_(u['EMPLOYEE NAME']); if (n) usersByName[n] = u;
  });
  return { branches: branches, departments: departments, usersByEmail: usersByEmail, usersByName: usersByName };
}

function validateBulkPayload_(payload, actor) {
  const sheets = collectBulkPayload_(payload);
  const ctx = bulkExistingContext_();
  const rows = [];

  function pushResult(sheet, r, errors, key, normalized) {
    rows.push({ sheet: sheet, rowNumber: r.rowNumber, valid: errors.length === 0, key: key || '', errors: errors, data: normalized || r.data });
  }

  sheets.BRANCHES.forEach(function(r) {
    const d = r.data, errors = [];
    const name = String(bulkCell_(d, ['BRANCH NAME','BRANCH']) || '').trim();
    const code = String(bulkCell_(d, 'BRANCH CODE') || '').trim().toUpperCase();
    const location = String(bulkCell_(d, 'LOCATION') || '').trim();
    const status = upper_(bulkCell_(d, 'STATUS') || 'ACTIVE');
    if (!name) errors.push('BRANCH NAME is required.');
    if (BULK_V2_ALLOWED_STATUS.indexOf(status) < 0) errors.push('STATUS must be ACTIVE or INACTIVE.');
    const n = normalizeName_(name);
    if (n && errors.length === 0) ctx.branches[n] = Object.assign({}, ctx.branches[n] || {}, { 'BRANCH NAME': name, 'BRANCH CODE': code, 'LOCATION': location, 'STATUS': status, __BULK: true });
    pushResult('BRANCHES', r, errors, name || code, { 'BRANCH NAME': name, 'BRANCH CODE': code, 'LOCATION': location, 'STATUS': status });
  });

  sheets.DEPARTMENTS.forEach(function(r) {
    const d = r.data, errors = [];
    const name = String(bulkCell_(d, ['DEPARTMENT NAME','DEPARTMENT']) || '').trim();
    const code = String(bulkCell_(d, 'DEPARTMENT CODE') || '').trim().toUpperCase();
    const head = String(bulkCell_(d, 'DEPARTMENT HEAD') || '').trim();
    const status = upper_(bulkCell_(d, 'STATUS') || 'ACTIVE');
    if (!name) errors.push('DEPARTMENT NAME is required.');
    if (BULK_V2_ALLOWED_STATUS.indexOf(status) < 0) errors.push('STATUS must be ACTIVE or INACTIVE.');
    const n = normalizeName_(name);
    if (n && errors.length === 0) ctx.departments[n] = Object.assign({}, ctx.departments[n] || {}, { 'DEPARTMENT NAME': name, 'DEPARTMENT CODE': code, 'DEPARTMENT HEAD': head, 'STATUS': status, __BULK: true });
    pushResult('DEPARTMENTS', r, errors, name || code, { 'DEPARTMENT NAME': name, 'DEPARTMENT CODE': code, 'DEPARTMENT HEAD': head, 'STATUS': status });
  });

  sheets.USERS.forEach(function(r) {
    const d = r.data, errors = [];
    const name = String(bulkCell_(d, 'EMPLOYEE NAME') || '').trim();
    const employeeId = String(bulkCell_(d, 'EMPLOYEE ID') || '').trim();
    const department = String(bulkCell_(d, 'DEPARTMENT') || '').trim();
    const branch = String(bulkCell_(d, ['BRANCH NAME','BRANCH / LOCATION','BRANCH']) || '').trim();
    const designation = String(bulkCell_(d, 'DESIGNATION') || '').trim();
    const email = normalizeEmail_(bulkCell_(d, ['EMAIL ADDRESS','EMPLOYEE EMAIL','EMAIL']));
    const contact = String(bulkCell_(d, ['CONTACT NUMBER','CONTACT']) || '').trim();
    const weeklyOff = String(bulkCell_(d, 'WEEKLY OFF') || '').trim();
    const manager = String(bulkCell_(d, ['REPORTING MANAGER','MANAGER']) || '').trim();
    const primaryBuddy = String(bulkCell_(d, 'PRIMARY BUDDY') || '').trim();
    const secondaryBuddy = String(bulkCell_(d, 'SECONDARY BUDDY') || '').trim();
    const role = normalizeRole_(bulkCell_(d, 'ROLE') || 'EMPLOYEE');
    const password = String(bulkCell_(d, 'PASSWORD') || '');
    const status = upper_(bulkCell_(d, 'STATUS') || 'ACTIVE');
    if (!name) errors.push('EMPLOYEE NAME is required.');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid EMAIL ADDRESS is required.');
    if (!department) errors.push('DEPARTMENT is required.');
    else if (!ctx.departments[normalizeName_(department)]) errors.push('DEPARTMENT was not found in Department Master or DEPARTMENTS upload sheet.');
    if (!branch) errors.push('BRANCH NAME is required.');
    else if (!ctx.branches[normalizeName_(branch)]) errors.push('BRANCH NAME was not found in Branch Master or BRANCHES upload sheet.');
    if (BULK_V2_ALLOWED_STATUS.indexOf(status) < 0) errors.push('STATUS must be ACTIVE or INACTIVE.');
    const rawRole = upper_(bulkCell_(d, 'ROLE') || 'EMPLOYEE');
    if (BULK_V2_ALLOWED_ROLES.indexOf(role) < 0 || (rawRole && BULK_V2_ALLOWED_ROLES.indexOf(rawRole) < 0 && rawRole !== 'USER')) errors.push('Invalid ROLE.');
    if (role === 'SUPER ADMIN' && actor && actor.role !== 'SUPER ADMIN') errors.push('Only Super Admin can import another Super Admin.');
    const existing = ctx.usersByEmail[email] || null;
    let existingAuth = null;
    if (email) { try { existingAuth = findAuthByEmail_(email); } catch (e) {} }
    if (!existing && password.length < 8) errors.push('PASSWORD with at least 8 characters is required for a new user.');
    if (existing && !existingAuth && password.length < 8) errors.push('PASSWORD is required because this existing user does not yet have a login account.');
    if (existing && password && password.length < 8) errors.push('PASSWORD must be at least 8 characters when supplied.');
    const normalized = {
      'EMPLOYEE NAME': name, 'EMPLOYEE ID': employeeId, 'DEPARTMENT': department, 'BRANCH NAME': branch,
      'DESIGNATION': designation, 'EMAIL ADDRESS': email, 'CONTACT NUMBER': contact, 'WEEKLY OFF': weeklyOff,
      'REPORTING MANAGER': manager, 'PRIMARY BUDDY': primaryBuddy, 'SECONDARY BUDDY': secondaryBuddy,
      'ROLE': role, 'PASSWORD': password, 'STATUS': status
    };
    if (errors.length === 0) {
      if (email) ctx.usersByEmail[email] = Object.assign({}, existing || {}, normalized, { __BULK: true });
      if (name) ctx.usersByName[normalizeName_(name)] = ctx.usersByEmail[email] || normalized;
    }
    pushResult('USERS', r, errors, email || name, normalized);
  });

  sheets.TASKS.forEach(function(r) {
    const d = r.data, errors = [];
    const email = normalizeEmail_(bulkCell_(d, ['EMPLOYEE EMAIL','EMAIL ADDRESS','EMAIL']));
    const name = String(bulkCell_(d, ['EMPLOYEE NAME','DOER NAME','USER']) || '').trim();
    const user = email ? ctx.usersByEmail[email] : ctx.usersByName[normalizeName_(name)];
    const department = String(bulkCell_(d, 'DEPARTMENT') || (user && (user['DEPARTMENT'] || user.DEPARTMENT)) || '').trim();
    const branch = String(bulkCell_(d, ['BRANCH NAME','BRANCH / LOCATION','BRANCH']) || (user && (user['BRANCH / LOCATION'] || user['BRANCH NAME'])) || '').trim();
    const coreTask = String(bulkCell_(d, ['CORE TASK','TASK']) || '').trim();
    const description = String(bulkCell_(d, ['TASK DESCRIPTION','DESCRIPTION']) || '').trim();
    const checklist = String(bulkCell_(d, ['CHECKLIST ITEM','CHECKLIST / TASK STEP','SUB TASK / CHECKLIST']) || '').trim();
    const frequency = normalizeBulkFrequency_(bulkCell_(d, 'FREQUENCY'));
    const startDate = normalizeBulkDate_(bulkCell_(d, ['TASK START DATE','START DATE']));
    const endDate = ''; // Fresh V5 recurring tasks do not use an end date.
    const startTime = normalizeBulkTime_(bulkCell_(d, ['START TIME','SCHEDULED START TIME']));
    const dueTime = normalizeBulkTime_(bulkCell_(d, ['DUE TIME','END TIME']));
    const priority = upper_(bulkCell_(d, 'PRIORITY') || 'MEDIUM');
    const taskType = normalizeTaskType_(bulkCell_(d, 'TASK TYPE'));
    const verificationRequired = normalizeBulkYesNo_(bulkCell_(d, 'VERIFICATION REQUIRED'), 'NO');
    const verifier = String(bulkCell_(d, 'VERIFIER') || '').trim();
    const buddyAllowed = normalizeBulkYesNo_(bulkCell_(d, 'BUDDY ALLOWED'), 'YES');
    const active = upper_(bulkCell_(d, 'ACTIVE') || 'ACTIVE');
    if (!email && !name) errors.push('EMPLOYEE EMAIL or EMPLOYEE NAME is required.');
    if (!user) errors.push('Employee was not found in User Master or USERS upload sheet.');
    if (user && name && normalizeName_(user['EMPLOYEE NAME'] || user['EMPLOYEE NAME']) !== normalizeName_(name)) errors.push('EMPLOYEE NAME does not match EMPLOYEE EMAIL.');
    if (user && department) { const userDept = String(user['DEPARTMENT'] || '').trim(); if (userDept && normalizeName_(userDept) !== normalizeName_(department)) errors.push('Task DEPARTMENT does not match the employee department.'); }
    if (!coreTask) errors.push('CORE TASK is required.');
    if (BULK_V2_ALLOWED_FREQUENCIES.indexOf(frequency) < 0) errors.push('Invalid FREQUENCY.');
    if (!startDate) errors.push('TASK START DATE is required and must be a valid date.');
    if (department && !ctx.departments[normalizeName_(department)]) errors.push('Task DEPARTMENT was not found.');
    if (branch && !ctx.branches[normalizeName_(branch)]) errors.push('Task BRANCH NAME was not found.');
    if (user && branch) {
      const userBranch = String(user['BRANCH / LOCATION'] || user['BRANCH NAME'] || '').trim();
      if (userBranch && normalizeName_(userBranch) !== normalizeName_(branch)) errors.push('Task BRANCH NAME does not match the employee branch.');
    }
    if (BULK_V2_ALLOWED_PRIORITIES.indexOf(priority) < 0) errors.push('PRIORITY must be LOW, MEDIUM, HIGH or CRITICAL.');
    if (verificationRequired === 'YES' && !verifier) errors.push('VERIFIER is required when VERIFICATION REQUIRED is YES.');
    if (verifier && !ctx.usersByName[normalizeName_(verifier)]) errors.push('VERIFIER must be an employee name found in User Master or USERS upload sheet.');
    if (['ACTIVE','INACTIVE'].indexOf(active) < 0) errors.push('ACTIVE must be ACTIVE or INACTIVE.');
    if (['CHECKBOX','UPLOAD'].indexOf(String(bulkCell_(d, 'TASK TYPE') || 'CHECKBOX').toUpperCase()) < 0) errors.push('TASK TYPE must be CHECKBOX or UPLOAD.');
    const normalized = {
      'EMPLOYEE EMAIL': email, 'EMPLOYEE NAME': name, 'DEPARTMENT': department, 'BRANCH NAME': branch,
      'CORE TASK': coreTask, 'TASK DESCRIPTION': description, 'FREQUENCY': frequency,
      'TASK START DATE': startDate, 'TASK END DATE': endDate, 'START TIME': startTime, 'DUE TIME': dueTime,
      'PRIORITY': priority, 'TASK TYPE': taskType, 'VERIFICATION REQUIRED': verificationRequired,
      'VERIFIER': verifier, 'BUDDY ALLOWED': buddyAllowed, 'ACTIVE': active
    };
    pushResult('TASKS', r, errors, (email || name) + ' | ' + coreTask, normalized);
  });

  const bySheet = {};
  ['BRANCHES','DEPARTMENTS','USERS','TASKS'].forEach(function(sheet) {
    const part = rows.filter(function(r) { return r.sheet === sheet; });
    bySheet[sheet] = { total: part.length, valid: part.filter(function(r){ return r.valid; }).length, invalid: part.filter(function(r){ return !r.valid; }).length };
  });
  const valid = rows.filter(function(r){ return r.valid; }).length;
  return {
    sheets: sheets,
    rows: rows,
    total: rows.length,
    valid: valid,
    invalid: rows.length - valid,
    bySheet: bySheet
  };
}

function previewBulkImport(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  const result = validateBulkPayload_(payload || {}, actor);
  return {
    success: true,
    version: BULK_V2_TEMPLATE_VERSION,
    total: result.total,
    valid: result.valid,
    invalid: result.invalid,
    bySheet: result.bySheet,
    rows: result.rows.slice(0, 500).map(function(r) { return { sheet:r.sheet,rowNumber:r.rowNumber,valid:r.valid,key:r.key,errors:r.errors }; })
  };
}

function importBulkData(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  payload = payload || {};
  const validation = validateBulkPayload_(payload, actor);
  const batchId = makeId_('IMP');
  const fileName = String(payload.fileName || 'Bulk Upload.xlsx').trim();
  const validRows = validation.rows.filter(function(r) { return r.valid; });
  const invalidRows = validation.rows.filter(function(r) { return !r.valid; });
  const result = { branches: 0, departments: 0, users: 0, taskTemplates: 0, checklistItems: 0, generatedToday: 0, failed: invalidRows.length };

  const lock = LockService.getUserLock();
  lock.waitLock(30000);
  try {
    invalidRows.forEach(function(r) {
      appendObject_(getSheet_(APP_CONFIG.SHEETS.BULK_IMPORT_ERRORS), {
        'BATCH ID': batchId,
        'SHEET NAME': r.sheet,
        'ROW NUMBER': r.rowNumber,
        'RECORD KEY': r.key,
        'ERROR MESSAGE': r.errors.join(' | '),
        'RAW DATA JSON': JSON.stringify(redactBulkData_(r.data || {})),
        'TIMESTAMP': nowStamp_()
      });
    });

    validRows.filter(function(r){ return r.sheet === 'BRANCHES'; }).forEach(function(r) {
      upsertBranchFromBulk_(r.data, actor); result.branches++;
    });
    validRows.filter(function(r){ return r.sheet === 'DEPARTMENTS'; }).forEach(function(r) {
      upsertDepartmentFromBulk_(r.data, actor); result.departments++;
    });
    validRows.filter(function(r){ return r.sheet === 'USERS'; }).forEach(function(r) {
      upsertUserFromBulk_(r.data, actor); result.users++;
    });

    const taskRows = validRows.filter(function(r){ return r.sheet === 'TASKS'; }).map(function(r) { return { rowNumber: r.rowNumber, data: r.data }; });
    const groups = buildBulkTaskGroups_(taskRows);
    groups.forEach(function(group) {
      const out = upsertTaskGroupFromBulk_(group, actor);
      if (out && out.templateId) result.taskTemplates++;
      result.checklistItems += Number(out && out.checklistAdded || 0);
      result.generatedToday += Number(out && out.generatedToday || 0);
    });

    appendObject_(getSheet_(APP_CONFIG.SHEETS.BULK_IMPORT_LOG), {
      'BATCH ID': batchId,
      'FILE NAME': fileName,
      'IMPORT TYPE': 'BRANCHES + DEPARTMENTS + USERS + TASKS',
      'UPLOADED BY USER ID': actor.userId,
      'UPLOADED BY': actor.name,
      'TIMESTAMP': nowStamp_(),
      'TOTAL ROWS': validation.total,
      'VALID ROWS': validation.valid,
      'INVALID ROWS': validation.invalid,
      'SUCCESS COUNT': validation.valid,
      'FAILED COUNT': validation.invalid,
      'STATUS': validation.invalid ? (validation.valid ? 'PARTIAL SUCCESS' : 'FAILED') : 'SUCCESS'
    });
    auditActor_(actor, { action: 'BULK IMPORT', newValue: batchId + ' | ' + fileName + ' | Valid ' + validation.valid + ' | Invalid ' + validation.invalid });
  } finally {
    lock.releaseLock();
  }

  return {
    success: true,
    batchId: batchId,
    fileName: fileName,
    total: validation.total,
    valid: validation.valid,
    invalid: validation.invalid,
    imported: result,
    message: 'Bulk import completed. Valid rows were imported; invalid rows were rejected and logged.'
  };
}

function upsertBranchFromBulk_(d, actor) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.BRANCHES);
  const name = String(d['BRANCH NAME'] || '').trim();
  const existing = findBranchByName_(name);
  const patch = {
    'BRANCH NAME': name,
    'BRANCH CODE': String(d['BRANCH CODE'] || '').trim().toUpperCase(),
    'LOCATION': String(d['LOCATION'] || '').trim(),
    'STATUS': upper_(d['STATUS'] || 'ACTIVE'),
    'UPDATED AT': nowStamp_()
  };
  if (existing) setObjectByRow_(sheet, existing.row, patch);
  else {
    patch['BRANCH ID'] = makeId_('BR'); patch['CREATED AT'] = nowStamp_(); appendObject_(sheet, patch);
  }
}

function upsertDepartmentFromBulk_(d, actor) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.DEPARTMENTS);
  const name = String(d['DEPARTMENT NAME'] || '').trim();
  const rows = readObjects_(sheet);
  let found = null;
  for (let i = 0; i < rows.length; i++) {
    if (normalizeName_(rows[i]['DEPARTMENT NAME']) === normalizeName_(name)) { found = { obj: rows[i], row: i + 2 }; break; }
  }
  const patch = {
    'DEPARTMENT NAME': name,
    'DEPARTMENT CODE': String(d['DEPARTMENT CODE'] || '').trim().toUpperCase(),
    'DEPARTMENT HEAD': String(d['DEPARTMENT HEAD'] || '').trim(),
    'STATUS': upper_(d['STATUS'] || 'ACTIVE'),
    'UPDATED AT': nowStamp_()
  };
  if (found) setObjectByRow_(sheet, found.row, patch);
  else { patch['DEPARTMENT ID'] = makeId_('DPT'); patch['CREATED AT'] = nowStamp_(); appendObject_(sheet, patch); }
}

function upsertUserFromBulk_(d, actor) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.USERS);
  const email = normalizeEmail_(d['EMAIL ADDRESS']);
  const found = findUserRowByEmail_(sheet, email);
  const role = normalizeRole_(d['ROLE'] || 'EMPLOYEE');
  enforceRoleAssignment_(actor, role);
  const payload = {
    name: d['EMPLOYEE NAME'], employeeId: d['EMPLOYEE ID'], department: d['DEPARTMENT'], branch: d['BRANCH NAME'],
    designation: d['DESIGNATION'], email: email, contact: d['CONTACT NUMBER'], weeklyOff: d['WEEKLY OFF'],
    manager: d['REPORTING MANAGER'], primaryBuddy: d['PRIMARY BUDDY'], secondaryBuddy: d['SECONDARY BUDDY'],
    status: d['STATUS'], active: d['STATUS'], availability: 'WORKING'
  };
  let userId;
  if (found) {
    userId = String(found.obj['USER ID'] || '').trim() || makeId_('USR');
    const record = buildUserRecord_(userId, payload, role);
    record['CREATED AT'] = found.obj['CREATED AT'] || nowStamp_();
    setObjectByRow_(sheet, found.row, record);
  } else {
    userId = makeId_('USR');
    appendObject_(sheet, buildUserRecord_(userId, payload, role));
  }
  const password = String(d['PASSWORD'] || '');
  upsertAuthAccount_(userId, email, role, password, !!password);
  return userId;
}

function findUserForBulkTask_(data) {
  const email = normalizeEmail_(data['EMPLOYEE EMAIL']);
  const name = String(data['EMPLOYEE NAME'] || '').trim();
  const users = getUsersRaw_();
  if (email) {
    const byEmail = users.find(function(u) { return normalizeEmail_(u['EMAIL ADDRESS']) === email; });
    if (byEmail) return byEmail;
  }
  if (name) return findUserByLooseName_(users, name);
  return null;
}

function bulkTaskSourceKey_(group, user) {
  const d = group.first || {};
  const raw = [
    String(user && user['USER ID'] || ''), normalizeName_(d['CORE TASK']), normalizeBulkFrequency_(d['FREQUENCY']),
    normalizeBulkDate_(d['TASK START DATE']), normalizeName_(d['DEPARTMENT']), normalizeName_(d['BRANCH NAME'])
  ].join('|');
  return stableId_('BULK', raw);
}

function upsertTaskGroupFromBulk_(group, actor) {
  const d = group.first || {};
  const user = findUserForBulkTask_(d);
  if (!user) throw new Error('Bulk task employee could not be resolved after user import.');
  const templateSheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const checklistSheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES);
  const sourceKey = bulkTaskSourceKey_(group, user);
  const templates = readObjects_(templateSheet);
  let found = null;
  for (let i = 0; i < templates.length; i++) {
    if (String(templates[i]['SOURCE KEY'] || '') === sourceKey) { found = { obj: templates[i], row: i + 2 }; break; }
  }
  const frequency = normalizeBulkFrequency_(d['FREQUENCY']);
  const startDate = normalizeBulkDate_(d['TASK START DATE']);
  const endDate = ''; // Fresh V5 recurring tasks do not use an end date.
  const weekday = weekdayName_(startDate);
  let detail = '';
  if (frequency === 'WEEKLY') detail = weekday;
  if (frequency === 'MONTHLY') detail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY' || frequency === 'YEARLY') detail = startDate.slice(5);
  const specificDate = ['ONE TIME','AS REQUIRED'].indexOf(frequency) >= 0 ? startDate : '';
  const templateId = found ? String(found.obj['TASK TEMPLATE ID'] || '') : makeId_('TPL');
  const active = upper_(d['ACTIVE'] || 'ACTIVE') === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const record = {
    'TASK TEMPLATE ID': templateId,
    'CORE TASK': String(d['CORE TASK'] || '').trim(),
    'TASK DESCRIPTION': String(d['TASK DESCRIPTION'] || '').trim(),
    'DEPARTMENT': String(d['DEPARTMENT'] || user['DEPARTMENT'] || '').trim(),
    'BRANCH NAME': String(d['BRANCH NAME'] || user['BRANCH / LOCATION'] || '').trim(),
    'DESIGNATION / ROLE': String(user['DESIGNATION'] || '').trim(),
    'DEFAULT USER': String(user['EMPLOYEE NAME'] || '').trim(),
    'DEFAULT USER ID': String(user['USER ID'] || ''),
    'TASK TYPE': normalizeTaskType_(payload.workType),
    'FREQUENCY': frequency,
    'FREQUENCY DETAIL': detail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '',
    'SPECIFIC DATE': specificDate,
    'START TIME': normalizeBulkTime_(d['START TIME']),
    'DUE TIME': normalizeBulkTime_(d['DUE TIME']),
    'PRIORITY': upper_(d['PRIORITY'] || 'MEDIUM'),
    'ATTACHMENT REQUIRED': normalizeBulkYesNo_(d['EVIDENCE REQUIRED'], 'YES'),
    'ATTACHMENT TYPE': normalizeBulkYesNo_(d['EVIDENCE REQUIRED'], 'YES') === 'YES' ? 'FILE / PHOTO' : '',
    'VERIFICATION REQUIRED': normalizeBulkYesNo_(d['VERIFICATION REQUIRED'], 'NO'),
    'VERIFIER': String(d['VERIFIER'] || '').trim(),
    'APPROVAL REQUIRED': 'NO',
    'APPROVER': '',
    'BUDDY ALLOWED': normalizeBulkYesNo_(d['BUDDY ALLOWED'], 'YES'),
    'ESCALATION RULE': 'PRIMARY BUDDY > SECONDARY BUDDY > MANAGER',
    'ACTIVE': active,
    'CREATED BY': found ? String(found.obj['CREATED BY'] || actor.name) : actor.name + ' (' + actor.role + ')',
    'CREATED AT': found ? (found.obj['CREATED AT'] || nowStamp_()) : nowStamp_(),
    'UPDATED AT': nowStamp_(),
    'TASK START DATE': startDate,
    'TASK END DATE': endDate,
    'SOURCE': 'BULK UPLOAD',
    'SOURCE KEY': sourceKey,
    'SOURCE CONTROL': 'FRESH V5 BULK',
    'SOURCE ROW IDS': group.rows.map(function(r){ return r.rowNumber; }).join(','),
    'SCHEDULE STATUS': active === 'ACTIVE' ? 'READY' : 'PAUSED'
  };
  if (found) setObjectByRow_(templateSheet, found.row, record);
  else appendObject_(templateSheet, record);

  const existingChecklist = readObjects_(checklistSheet).filter(function(c) { return String(c['TASK TEMPLATE ID'] || '') === templateId && upper_(c['ACTIVE'] || 'ACTIVE') !== 'INACTIVE'; });
  const existingText = {};
  existingChecklist.forEach(function(c) { existingText[normalizeName_(c['CHECKLIST ITEM'])] = true; });
  let checklistAdded = 0;
  group.checklist.forEach(function(text, index) {
    const key = normalizeName_(text);
    if (!key || existingText[key]) return;
    appendObject_(checklistSheet, {
      'CHECKLIST TEMPLATE ID': makeId_('CT'),
      'TASK TEMPLATE ID': templateId,
      'CORE TASK': record['CORE TASK'],
      'CHECKLIST SEQUENCE': existingChecklist.length + checklistAdded + 1,
      'CHECKLIST ITEM': text,
      'MANDATORY': 'YES',
      'EVIDENCE REQUIRED': 'NO',
      'EVIDENCE TYPE': '',
      'ACTIVE': 'ACTIVE',
      'CREATED AT': nowStamp_(),
      'UPDATED AT': nowStamp_(),
      'SOURCE': 'BULK UPLOAD',
      'SOURCE KEY': sourceKey,
      'SOURCE ROW ID': String(group.rows[index] && group.rows[index].rowNumber || '')
    });
    existingText[key] = true;
    checklistAdded++;
  });

  let generatedToday = 0;
  if (active === 'ACTIVE' && templateAppliesOnDate_(record, todayKey_())) {
    const g = generateTasksForDate_(todayKey_(), templateId);
    generatedToday = Number(g && g.created || 0);
  }
  auditActor_(actor, { action: found ? 'BULK TASK TEMPLATE UPDATED' : 'BULK TASK TEMPLATE CREATED', newValue: templateId + ' | ' + record['CORE TASK'] });
  return { templateId: templateId, checklistAdded: checklistAdded, generatedToday: generatedToday };
}

function listBulkImportHistory(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.BULK_IMPORT_LOG));
  return rows.slice(-100).reverse().map(function(r) {
    return {
      batchId: String(r['BATCH ID'] || ''),
      fileName: String(r['FILE NAME'] || ''),
      uploadedBy: String(r['UPLOADED BY'] || ''),
      timestamp: displayDateTime_(r['TIMESTAMP']) || String(r['TIMESTAMP'] || ''),
      total: Number(r['TOTAL ROWS'] || 0),
      valid: Number(r['VALID ROWS'] || 0),
      invalid: Number(r['INVALID ROWS'] || 0),
      success: Number(r['SUCCESS COUNT'] || 0),
      failed: Number(r['FAILED COUNT'] || 0),
      status: String(r['STATUS'] || '')
    };
  });
}

function listBulkImportErrors(sessionToken, batchId) {
  const actor = requireSession_(sessionToken);
  requireAdmin_(actor);
  return readObjects_(getSheet_(APP_CONFIG.SHEETS.BULK_IMPORT_ERRORS))
    .filter(function(r) { return !batchId || String(r['BATCH ID'] || '') === String(batchId); })
    .slice(-300).reverse().map(function(r) {
      return {
        batchId: String(r['BATCH ID'] || ''), sheet: String(r['SHEET NAME'] || ''), rowNumber: Number(r['ROW NUMBER'] || 0),
        key: String(r['RECORD KEY'] || ''), error: String(r['ERROR MESSAGE'] || ''), timestamp: displayDateTime_(r['TIMESTAMP']) || String(r['TIMESTAMP'] || '')
      };
    });
}

/** Fresh V3 bulk support helpers. */
function redactBulkData_(data) {
  const out = {};
  Object.keys(data || {}).forEach(function(k) {
    out[k] = normalizeBulkHeader_(k) === 'PASSWORD' ? '[REDACTED]' : data[k];
  });
  return out;
}


/** Secure public wrappers for legacy maintenance endpoints. */



/* =====================================================================
 * FRESH V5 BEHAVIOR OVERRIDES — 2026-08-20
 * - My Tasks = today + previous unfinished backlog
 * - recurring tasks never use an end date
 * - weekly off creates no task instance
 * - evidence requirement is controlled per template by Super Admin
 * ===================================================================== */

function isWeeklyOffOnDate_(user, date) {
  if (!user) return false;
  const weeklyOff = upper_(user['WEEKLY OFF'] || '');
  if (!weeklyOff) return false;
  return weeklyOff.indexOf(upper_(weekdayName_(date))) >= 0;
}

function shouldEmployeeSeeTask_(task, today) {
  const taskDate = dateKey_(task['TASK DATE']);
  if (!taskDate || taskDate > today) return false;
  if (taskDate === today) return true;
  return ['PENDING','IN PROGRESS','OVERDUE','REASSIGNED','REJECTED'].indexOf(upper_(task['STATUS'] || 'PENDING')) >= 0;
}

function permissionMap_(actor) {
  return {
    viewAllTasks: canViewAllTasks_(actor),
    manageTasks: canManageTasks_(actor),
    manageUsers: isAdmin_(actor),
    manageDepartments: isAdmin_(actor),
    manageBranches: isAdmin_(actor),
    manageBulkImport: isAdmin_(actor),
    manageSecurity: isAdmin_(actor),
    manageEvidenceRules: !!actor && actor.role === 'SUPER ADMIN',
    completeOnBehalf: canViewAllTasks_(actor),
    sendReminders: canViewAllTasks_(actor),
    manageTemplates: canManageTasks_(actor),
    manageHolidays: isAdmin_(actor),
    manageSettings: isAdmin_(actor),
    viewAudit: isAdmin_(actor)
  };
}

function initializeSystemSettings_() {
  upsertSetting_('SESSION_HOURS','12','Login session validity in hours','SYSTEM');
  upsertSetting_('PASSWORD_MIN_LENGTH','8','Minimum password length','SYSTEM');
  upsertSetting_('DEFAULT_TASK_EVIDENCE_REQUIRED','YES','Default evidence policy for tasks created by Process Coordinator/Admin. Super Admin can override per task template.','SYSTEM');
  upsertSetting_('EVIDENCE_REQUIRED_FOR_COMPLETION','PER TEMPLATE','Legacy setting retained for compatibility. Evidence is controlled per task template in Fresh V5.','SYSTEM');
}

function forceMandatoryEvidenceOnLiveTasks_() {
  // Fresh V5 intentionally does nothing. Evidence is controlled per template/task.
  return { success: true, mode: 'PER TEMPLATE' };
}

function generateTasksForDate_(date, onlyTemplateId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const templates = readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
    const users = getUsersRaw_();
    const availability = buildAvailabilityMap_(date);
    const liveSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
    const existing = readObjects_(liveSheet);
    const existingIds = new Set(existing.map(function(r) { return String(r['TASK INSTANCE ID'] || ''); }));
    const checklistTemplates = readObjects_(getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES));
    let created = 0;

    templates.forEach(function(t) {
      const templateId = String(t['TASK TEMPLATE ID'] || '').trim();
      if (!templateId) return;
      if (onlyTemplateId && templateId !== onlyTemplateId) return;
      if (upper_(t['ACTIVE'] || 'ACTIVE') !== 'ACTIVE') return;
      if (!templateAppliesOnDate_(t, date)) return;

      const instanceId = 'INST-' + templateId + '-' + date.replace(/-/g,'');
      if (existingIds.has(instanceId)) return;

      const original = findUser_(users, t['DEFAULT USER ID'] || t['DEFAULT USER']);
      if (!original) return;
      // Weekly off = no task instance at all. Leave/unavailability can still use buddy logic.
      if (isWeeklyOffOnDate_(original, date)) return;

      const assignment = resolveAssignee_(original, users, availability, t, date);
      const assignee = assignment.user || original;
      const relatedChecklist = checklistTemplates.filter(function(c) {
        return String(c['TASK TEMPLATE ID'] || '') === templateId && upper_(c['ACTIVE'] || 'ACTIVE') !== 'INACTIVE';
      });
      const evidenceRequired = yes_(t['ATTACHMENT REQUIRED']);

      appendObject_(liveSheet, {
        'TASK INSTANCE ID': instanceId,
        'TASK TEMPLATE ID': templateId,
        'TASK DATE': date,
        'CORE TASK': t['CORE TASK'],
        'TASK DESCRIPTION': t['TASK DESCRIPTION'],
        'TASK TYPE': t['TASK TYPE'] || 'CORE TASK',
        'DEPARTMENT': t['DEPARTMENT'] || original['DEPARTMENT'],
        'BRANCH NAME': t['BRANCH NAME'] || original['BRANCH / LOCATION'],
        'ORIGINAL USER ID': original['USER ID'],
        'ORIGINAL OWNER': original['EMPLOYEE NAME'],
        'CURRENT ASSIGNEE ID': assignee['USER ID'],
        'CURRENT ASSIGNEE': assignee['EMPLOYEE NAME'],
        'ASSIGNMENT TYPE': assignment.type,
        'BUDDY TASK': assignment.type === 'ORIGINAL' ? 'NO' : 'YES',
        'ASSIGNED BY': 'SYSTEM',
        'PRIORITY': t['PRIORITY'] || 'MEDIUM',
        'SCHEDULED START TIME': t['START TIME'],
        'DUE TIME': t['DUE TIME'],
        'STATUS': 'PENDING',
        'CHECKLIST TOTAL': relatedChecklist.length,
        'CHECKLIST COMPLETED': 0,
        'CHECKLIST PROGRESS %': 0,
        'ATTACHMENT REQUIRED': yes_(t['ATTACHMENT REQUIRED']) ? 'YES' : 'NO',
        'ATTACHMENT COUNT': 0,
        'VERIFICATION REQUIRED': yes_(t['VERIFICATION REQUIRED']) ? 'YES' : 'NO',
        'VERIFICATION STATUS': yes_(t['VERIFICATION REQUIRED']) ? 'PENDING' : 'NOT REQUIRED',
        'VERIFIER': t['VERIFIER'],
        'APPROVAL REQUIRED': yes_(t['APPROVAL REQUIRED']) ? 'YES' : 'NO',
        'APPROVAL STATUS': yes_(t['APPROVAL REQUIRED']) ? 'PENDING' : 'NOT REQUIRED',
        'APPROVER': t['APPROVER'],
        'CREATED AT': nowStamp_(),
        'UPDATED AT': nowStamp_()
      });

      const checklistSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
      relatedChecklist.forEach(function(c) {
        appendObject_(checklistSheet, {
          'TASK INSTANCE ID': instanceId,
          'CHECKLIST INSTANCE ID': 'CI-' + String(c['CHECKLIST TEMPLATE ID'] || makeId_('CT')) + '-' + date.replace(/-/g,''),
          'TASK TEMPLATE ID': templateId,
          'CHECKLIST TEMPLATE ID': c['CHECKLIST TEMPLATE ID'],
          'CORE TASK': t['CORE TASK'],
          'CHECKLIST SEQUENCE': c['CHECKLIST SEQUENCE'],
          'CHECKLIST ITEM': c['CHECKLIST ITEM'],
          'MANDATORY': yes_(c['MANDATORY']) ? 'YES' : 'NO',
          'STATUS': 'PENDING',
          'EVIDENCE REQUIRED': yes_(c['EVIDENCE REQUIRED']) ? 'YES' : 'NO',
          'EVIDENCE COUNT': 0,
          'CREATED AT': nowStamp_(),
          'UPDATED AT': nowStamp_()
        });
      });

      audit_({ taskId: instanceId, userName: 'SYSTEM', action: 'TASK GENERATED', newValue: String(t['CORE TASK'] || '') + (evidenceRequired ? ' | EVIDENCE REQUIRED' : ' | EVIDENCE OPTIONAL') });
      existingIds.add(instanceId);
      created++;
    });

    if (!onlyTemplateId && date === todayKey_()) {
      PropertiesService.getScriptProperties().setProperty('LAST_TASK_GENERATION_DATE', date);
    }
    return { success: true, date: date, created: created };
  } finally {
    lock.releaseLock();
  }
}

function templateAppliesOnDate_(t, date) {
  const start = dateKey_(t['TASK START DATE']) || dateKey_(t['SPECIFIC DATE']);
  const frequency = upper_(t['FREQUENCY'] || 'DAILY');
  if (!start) return false;
  if (date < start) return false;
  if (frequency === 'DAILY') return true;
  if (frequency === 'WEEKLY' || frequency === 'SPECIFIC WEEKDAY') {
    const target = upper_(t['SPECIFIC WEEKDAY'] || t['FREQUENCY DETAIL'] || weekdayName_(start));
    return upper_(weekdayName_(date)) === target;
  }
  if (frequency === 'MONTHLY') {
    const day = Number(t['FREQUENCY DETAIL'] || start.slice(8,10));
    return Number(date.slice(8,10)) === day;
  }
  if (frequency === 'QUARTERLY') {
    const sy = Number(start.slice(0,4)), sm = Number(start.slice(5,7)), sd = Number(start.slice(8,10));
    const y = Number(date.slice(0,4)), m = Number(date.slice(5,7)), d = Number(date.slice(8,10));
    const monthGap = (y * 12 + m) - (sy * 12 + sm);
    return monthGap >= 0 && monthGap % 3 === 0 && d === sd;
  }
  if (frequency === 'YEARLY') return date.slice(5) === String(t['FREQUENCY DETAIL'] || start.slice(5));
  if (frequency === 'ONE TIME' || frequency === 'AS REQUIRED' || frequency === 'SPECIFIC DATE') {
    return date === (dateKey_(t['SPECIFIC DATE']) || start);
  }
  if (frequency === 'ALTERNATE DAYS') {
    return dayDiff_(start, date) >= 0 && dayDiff_(start, date) % 2 === 0;
  }
  return false;
}

function listTasks(sessionToken, filters) {
  ensureTodayGenerated_();
  markOverdueTasks_();
  const actor = requireSession_(sessionToken);
  filters = filters || {};
  const today = todayKey_();
  const scope = String(filters.scope || '').trim().toUpperCase();
  const requestedUserId = String(filters.userId || '').trim();
  const department = String(filters.department || '').trim();
  const branch = String(filters.branch || '').trim();
  const status = upper_(filters.status || '');
  const priority = upper_(filters.priority || '');
  const search = String(filters.search || '').trim().toLowerCase();
  const frequency = upper_(filters.frequency || '');
  const requestedDate = String(filters.date || today);

  let tasks = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS));
  if (scope === 'MY_ACTIVE') {
    tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId && shouldEmployeeSeeTask_(r, today); });
  } else if (scope === 'TODAY') {
    tasks = tasks.filter(function(r) { return dateKey_(r['TASK DATE']) === today; });
    if (!canViewAllTasks_(actor)) tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId; });
    else if (requestedUserId) tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === requestedUserId; });
  } else if (canViewAllTasks_(actor)) {
    tasks = tasks.filter(function(r) { return dateKey_(r['TASK DATE']) === requestedDate; });
    if (requestedUserId) tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === requestedUserId; });
  } else {
    tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId && shouldEmployeeSeeTask_(r, today); });
  }

  if (canViewAllTasks_(actor)) {
    if (department) tasks = tasks.filter(function(r) { return String(r['DEPARTMENT'] || '') === department; });
    if (branch) tasks = tasks.filter(function(r) { return String(r['BRANCH NAME'] || '') === branch; });
  }
  if (status) tasks = tasks.filter(function(r) { return upper_(r['STATUS']) === status; });
  if (priority) tasks = tasks.filter(function(r) { return upper_(r['PRIORITY']) === priority; });
  if (frequency) {
    const templateMap = {};
    readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES)).forEach(function(t) { templateMap[String(t['TASK TEMPLATE ID'] || '')] = upper_(t['FREQUENCY']); });
    tasks = tasks.filter(function(r) { return templateMap[String(r['TASK TEMPLATE ID'] || '')] === frequency; });
  }
  if (search) tasks = tasks.filter(function(r) {
    return [r['CORE TASK'],r['TASK DESCRIPTION'],r['ORIGINAL OWNER'],r['CURRENT ASSIGNEE'],r['DEPARTMENT'],r['BRANCH NAME']].join(' ').toLowerCase().indexOf(search) >= 0;
  });
  return taskObjectsForClient_(tasks, actor);
}

function taskObjectsForClient_(tasks, actor) {
  const ids = {};
  tasks.forEach(function(t) { ids[String(t['TASK INSTANCE ID'] || '')] = true; });
  const grouped = {};
  readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS)).forEach(function(c) {
    const id = String(c['TASK INSTANCE ID'] || '');
    if (!ids[id]) return;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push({ checklistInstanceId: String(c['CHECKLIST INSTANCE ID'] || ''), text: String(c['CHECKLIST ITEM'] || ''), mandatory: yes_(c['MANDATORY']), status: upper_(c['STATUS'] || 'PENDING'), completedBy: String(c['COMPLETED BY'] || ''), completedAt: displayDateTime_(c['COMPLETED AT']) });
  });
  tasks.sort(function(a,b) {
    const da = dateKey_(a['TASK DATE']), db = dateKey_(b['TASK DATE']);
    if (da !== db) return da.localeCompare(db);
    return timeToMinutes_(a['DUE TIME']) - timeToMinutes_(b['DUE TIME']);
  });
  return tasks.map(function(r) {
    const own = String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId;
    return {
      taskId: String(r['TASK INSTANCE ID'] || ''), templateId: String(r['TASK TEMPLATE ID'] || ''), taskDate: dateKey_(r['TASK DATE']),
      coreTask: String(r['CORE TASK'] || ''), description: String(r['TASK DESCRIPTION'] || ''), department: String(r['DEPARTMENT'] || ''), branch: String(r['BRANCH NAME'] || ''),
      originalOwner: String(r['ORIGINAL OWNER'] || ''), currentAssignee: String(r['CURRENT ASSIGNEE'] || ''), currentAssigneeId: String(r['CURRENT ASSIGNEE ID'] || ''), assignmentType: String(r['ASSIGNMENT TYPE'] || ''),
      priority: upper_(r['PRIORITY'] || 'MEDIUM'), startTime: displayTime_(r['SCHEDULED START TIME']), dueTime: displayTime_(r['DUE TIME']), status: upper_(r['STATUS'] || 'PENDING'),
     workType: upper_(r['TASK TYPE'] || 'TASK'),
      checklistTotal: Number(r['CHECKLIST TOTAL'] || 0), checklistCompleted: Number(r['CHECKLIST COMPLETED'] || 0), checklistPct: Number(r['CHECKLIST PROGRESS %'] || 0),
      attachmentRequired: yes_(r['ATTACHMENT REQUIRED']), attachmentCount: Number(r['ATTACHMENT COUNT'] || 0),
      verificationRequired: yes_(r['VERIFICATION REQUIRED']), verificationStatus: upper_(r['VERIFICATION STATUS'] || ''), verifier: String(r['VERIFIER'] || ''),
      onTimeDelayed: upper_(r['ON TIME / DELAYED'] || ''), delayMinutes: Number(r['DELAY MINUTES'] || 0), remark: String(r['REMARK'] || ''), completedBy: String(r['COMPLETED BY'] || ''), completionMode: String(r['COMPLETION MODE'] || ''),
      canAct: own || canViewAllTasks_(actor), canCompleteOnBehalf: !own && canViewAllTasks_(actor),
      checklists: (grouped[String(r['TASK INSTANCE ID'] || '')] || []).sort(function(a,b) { return a.text.localeCompare(b.text); })
    };
  });
}

function addNewTask(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  payload = payload || {};
  const userId = String(payload.userId || '').trim();
  const coreTask = String(payload.coreTask || '').trim();
  const frequency = upper_(payload.frequency || 'DAILY');
  const startDate = String(payload.startDate || '').trim();
  if (!userId) throw new Error('Please select a user.');
  if (!coreTask) throw new Error('Please enter the task name.');
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Please select a valid task start date.');
  if (['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME','AS REQUIRED'].indexOf(frequency) < 0) throw new Error('Invalid task frequency.');
  const user = findUserByIdRaw_(userId);
  if (!user) throw new Error('Selected user was not found.');

  const taskType = normalizeTaskType_(payload.workType);
  const evidenceRequired = taskType === 'UPLOAD';
  const templateId = makeId_('TPL');
  const now = nowStamp_();
  const weekday = weekdayName_(startDate);
  const specificDate = ['ONE TIME','AS REQUIRED'].indexOf(frequency) >= 0 ? startDate : '';
  let detail = '';
  if (frequency === 'WEEKLY') detail = weekday;
  if (frequency === 'MONTHLY') detail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY' || frequency === 'YEARLY') detail = startDate.slice(5);

  appendObject_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES), {
    'TASK TEMPLATE ID': templateId, 'CORE TASK': coreTask, 'TASK DESCRIPTION': String(payload.description || '').trim(),
    'DEPARTMENT': String(payload.department || user['DEPARTMENT'] || '').trim(), 'BRANCH NAME': String(user['BRANCH / LOCATION'] || '').trim(),
    'DESIGNATION / ROLE': String(user['DESIGNATION'] || '').trim(), 'DEFAULT USER': String(user['EMPLOYEE NAME'] || '').trim(), 'DEFAULT USER ID': userId,
    'TASK TYPE': taskType, 'FREQUENCY': frequency, 'FREQUENCY DETAIL': detail, 'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate,
    'TASK START DATE': startDate, 'TASK END DATE': '', 'START TIME': String(payload.startTime || '').trim(), 'DUE TIME': String(payload.dueTime || '').trim(), 'PRIORITY': upper_(payload.priority || 'MEDIUM'),
    'ATTACHMENT REQUIRED': evidenceRequired ? 'YES' : 'NO', 'ATTACHMENT TYPE': evidenceRequired ? 'FILE / PHOTO' : '',
    'VERIFICATION REQUIRED': payload.verificationRequired ? 'YES' : 'NO', 'VERIFIER': String(payload.verifier || '').trim(), 'APPROVAL REQUIRED': 'NO', 'APPROVER': '',
    'BUDDY ALLOWED': payload.buddyAllowed === false ? 'NO' : 'YES', 'ESCALATION RULE': 'PRIMARY BUDDY > SECONDARY BUDDY > MANAGER',
    'ACTIVE': 'ACTIVE', 'CREATED BY': actor.name + ' (' + actor.role + ')', 'CREATED AT': now, 'UPDATED AT': now, 'SOURCE': 'WEB APP', 'SCHEDULE STATUS': 'READY'
  });

  const checklistLines = String(payload.checklistText || '').split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
  const checklistSheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES);
  checklistLines.forEach(function(item, index) {
    appendObject_(checklistSheet, {
      'CHECKLIST TEMPLATE ID': makeId_('CT'), 'TASK TEMPLATE ID': templateId, 'CORE TASK': coreTask, 'CHECKLIST SEQUENCE': index + 1,
      'CHECKLIST ITEM': item, 'MANDATORY': 'YES', 'EVIDENCE REQUIRED': 'NO', 'ACTIVE': 'ACTIVE', 'CREATED AT': now, 'UPDATED AT': now, 'SOURCE': 'WEB APP'
    });
  });

  if (templateAppliesOnDate_({ 'FREQUENCY': frequency, 'TASK START DATE': startDate, 'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate, 'FREQUENCY DETAIL': detail }, todayKey_())) {
    generateTasksForDate_(todayKey_(), templateId);
  }
  auditActor_(actor, { action: 'TASK TEMPLATE CREATED', newValue: templateId + ' | ' + coreTask + ' | Evidence ' + (evidenceRequired ? 'YES' : 'NO') });
  return { success: true, templateId: templateId, message: 'Task added successfully.' };
}

function listTaskTemplates(sessionToken) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
  const checklistCounts = {};
  readObjects_(getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES)).forEach(function(c) {
    const id = String(c['TASK TEMPLATE ID'] || '');
    if (id && upper_(c['ACTIVE'] || 'ACTIVE') !== 'INACTIVE') checklistCounts[id] = (checklistCounts[id] || 0) + 1;
  });
  return rows.filter(function(r) { return String(r['TASK TEMPLATE ID'] || '').trim(); }).map(function(r) {
    const id = String(r['TASK TEMPLATE ID'] || '');
    return {
      templateId: id, task: String(r['CORE TASK'] || ''), user: String(r['DEFAULT USER'] || ''), userId: String(r['DEFAULT USER ID'] || ''), department: String(r['DEPARTMENT'] || ''),
      frequency: upper_(r['FREQUENCY'] || ''), startDate: dateKey_(r['TASK START DATE']), startTime: displayTime_(r['START TIME']), dueTime: displayTime_(r['DUE TIME']), priority: upper_(r['PRIORITY'] || ''),
      active: upper_(r['ACTIVE'] || 'ACTIVE'), scheduleStatus: upper_(r['SCHEDULE STATUS'] || (r['TASK START DATE'] ? 'READY' : 'NEEDS START DATE')),
      source: String(r['SOURCE'] || 'WEB APP'), control: String(r['SOURCE CONTROL'] || ''), checklistCount: checklistCounts[id] || 0,
      evidenceRequired: yes_(r['ATTACHMENT REQUIRED']), canManageEvidence: actor.role === 'SUPER ADMIN'
    };
  }).sort(function(a,b) { return a.user.localeCompare(b.user) || a.task.localeCompare(b.task); });
}

function setTemplateEvidenceRequired(sessionToken, templateId, required) {
  const actor = requireSession_(sessionToken);
  requireRoles_(actor, ['SUPER ADMIN']);
  const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const found = findRowById_(sheet, 'TASK TEMPLATE ID', String(templateId || ''));
  if (!found) throw new Error('Task template not found.');
  const flag = required ? 'YES' : 'NO';
  setObjectByRow_(sheet, found.row, { 'ATTACHMENT REQUIRED': flag, 'ATTACHMENT TYPE': required ? 'FILE / PHOTO' : '', 'UPDATED AT': nowStamp_() });

  const liveSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  readObjects_(liveSheet).forEach(function(r, i) {
    if (String(r['TASK TEMPLATE ID'] || '') !== String(templateId || '')) return;
    if (['COMPLETED','COMPLETED LATE','AWAITING VERIFICATION'].indexOf(upper_(r['STATUS'])) >= 0) return;
    setObjectByRow_(liveSheet, i + 2, { 'ATTACHMENT REQUIRED': flag, 'UPDATED AT': nowStamp_() });
  });
  auditActor_(actor, { action: 'TASK EVIDENCE RULE UPDATED', newValue: String(templateId || '') + ' | ' + flag });
  return { success: true, evidenceRequired: required };
}

function updateTemplateSchedule(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  payload = payload || {};
  const templateId = String(payload.templateId || '').trim();
  const startDate = String(payload.startDate || '').trim();
  if (!templateId) throw new Error('Task template ID is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Please enter a valid start date.');
  const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const found = findRowById_(sheet, 'TASK TEMPLATE ID', templateId);
  if (!found) throw new Error('Task template not found.');
  const frequency = upper_(found.obj['FREQUENCY'] || 'DAILY');
  const weekday = weekdayName_(startDate);
  let detail = '', specificDate = '';
  if (frequency === 'WEEKLY') detail = weekday;
  if (frequency === 'MONTHLY') detail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY' || frequency === 'YEARLY') detail = startDate.slice(5);
  if (frequency === 'ONE TIME' || frequency === 'AS REQUIRED') specificDate = startDate;
  setObjectByRow_(sheet, found.row, {
    'TASK START DATE': startDate, 'TASK END DATE': '', 'FREQUENCY DETAIL': detail,
    'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate,
    'ACTIVE': 'ACTIVE', 'SCHEDULE STATUS': 'READY', 'UPDATED AT': nowStamp_()
  });
  if (templateAppliesOnDate_(Object.assign({}, found.obj, { 'TASK START DATE': startDate, 'TASK END DATE': '', 'FREQUENCY DETAIL': detail, 'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate }), todayKey_())) {
    generateTasksForDate_(todayKey_(), templateId);
  }
  auditActor_(actor, { action: 'TASK TEMPLATE SCHEDULE UPDATED', newValue: templateId + ' | ' + startDate + ' | NO END DATE' });
  return { success: true };
}

function completeTask(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const found = requireTaskActionAccess_(actor, taskId);
  const task = found.obj;
  const own = String(task['CURRENT ASSIGNEE ID'] || '') === actor.userId;
  if (!own && !canViewAllTasks_(actor)) throw new Error('You can only complete your own task.');
  const remark = own ? '' : String(payload.remark || '').trim();
  if (!own && !remark) throw new Error('A follow-up/completion remark is required when completing a task on behalf of a user.');

  const checklistRows = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS)).filter(function(c) { return String(c['TASK INSTANCE ID'] || '') === taskId; });
  const mandatoryPending = checklistRows.filter(function(c) { return yes_(c['MANDATORY']) && upper_(c['STATUS']) !== 'COMPLETED'; });
  if (mandatoryPending.length) throw new Error('Complete all mandatory checklist items first (' + mandatoryPending.length + ' pending).');
  if (yes_(task['ATTACHMENT REQUIRED']) && Number(task['ATTACHMENT COUNT'] || 0) < 1) {
    throw new Error('Upload Work is required before completing this task.');
  }

  const delay = delayMinutes_(dateKey_(task['TASK DATE']), task['DUE TIME'], new Date());
  const late = delay > 0;
  const verificationRequired = yes_(task['VERIFICATION REQUIRED']);
  const newStatus = verificationRequired ? 'AWAITING VERIFICATION' : (late ? 'COMPLETED LATE' : 'COMPLETED');
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  setObjectByRow_(sheet, found.row, {
    'ACTUAL COMPLETION TIME': nowStamp_(), 'STATUS': newStatus, 'ON TIME / DELAYED': late ? 'DELAYED' : 'ON TIME', 'DELAY MINUTES': delay,
    'REMARK': remark, 'VERIFICATION STATUS': verificationRequired ? 'PENDING' : String(task['VERIFICATION STATUS'] || 'NOT REQUIRED'),
    'ATTACHMENT REQUIRED': yes_(task['ATTACHMENT REQUIRED']) ? 'YES' : 'NO',
    'COMPLETED BY USER ID': actor.userId, 'COMPLETED BY': actor.name, 'COMPLETED BY ROLE': actor.role, 'COMPLETION MODE': own ? 'OWN' : 'ON BEHALF', 'UPDATED AT': nowStamp_()
  });
  if (verificationRequired) createVerificationRecord_(taskId, found.row, task);
  auditActor_(actor, { taskId: taskId, action: own ? 'TASK COMPLETED' : 'TASK COMPLETED ON BEHALF', previousValue: upper_(task['STATUS']), newValue: newStatus + (remark ? ' | ' + remark : '') });
  return { success: true, status: newStatus, delayMinutes: delay, completionMode: own ? 'OWN' : 'ON BEHALF' };
}

function uploadTaskEvidence(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  if (!taskId) throw new Error('Task ID is required.');
  requireTaskActionAccess_(actor, taskId);
  if (!payload.fileName || !payload.base64) throw new Error('Please select a file.');
  const taskSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const found = findRowById_(taskSheet, 'TASK INSTANCE ID', taskId);
  const bytes = Utilities.base64Decode(String(payload.base64));
  if (bytes.length > 7 * 1024 * 1024) throw new Error('Please upload a file smaller than 7 MB.');
  const folder = getEvidenceFolder_();
  const safeName = taskId + '_' + Utilities.formatDate(new Date(), APP_CONFIG.TZ, 'yyyyMMdd_HHmmss') + '_' + sanitizeFileName_(payload.fileName);
  const blob = Utilities.newBlob(bytes, String(payload.mimeType || 'application/octet-stream'), safeName);
  const file = folder.createFile(blob);
  appendObject_(getSheet_(APP_CONFIG.SHEETS.ATTACHMENTS), {
    'ATTACHMENT ID': makeId_('ATT'), 'TASK INSTANCE ID': taskId, 'CHECKLIST INSTANCE ID': String(payload.checklistId || ''), 'TASK TEMPLATE ID': String(found.obj['TASK TEMPLATE ID'] || ''),
    'FILE NAME': safeName, 'FILE TYPE': String(payload.mimeType || ''), 'FILE URL': file.getUrl(), 'DRIVE FILE ID': file.getId(), 'EVIDENCE TYPE': 'WORK UPLOAD',
    'UPLOADED BY': actor.name, 'UPLOADED BY USER ID': actor.userId, 'UPLOADED DATE': todayKey_(), 'UPLOADED TIME': nowTime_(), 'CREATED AT': nowStamp_()
  });
  const count = Number(found.obj['ATTACHMENT COUNT'] || 0) + 1;
  setObjectByRow_(taskSheet, found.row, { 'ATTACHMENT COUNT': count, 'UPDATED AT': nowStamp_() });
  auditActor_(actor, { taskId: taskId, action: 'WORK UPLOADED', newValue: file.getUrl() });
  return { success: true, fileUrl: file.getUrl(), attachmentCount: count };
}

function setTemplateActiveSecure_(templateId, active, actor) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const found = findRowById_(sheet, 'TASK TEMPLATE ID', templateId);
  if (!found) throw new Error('Task template not found.');
  if (active) {
    const frequency = upper_(found.obj['FREQUENCY'] || '');
    if (['WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME'].indexOf(frequency) >= 0 && !dateKey_(found.obj['TASK START DATE'])) throw new Error('Set the task start date before activating this recurring task.');
  }
  setObjectByRow_(sheet, found.row, { 'ACTIVE': active ? 'ACTIVE' : 'INACTIVE', 'SCHEDULE STATUS': active ? 'READY' : 'PAUSED', 'UPDATED AT': nowStamp_() });
  auditActor_(actor, { action: active ? 'TASK TEMPLATE ACTIVATED' : 'TASK TEMPLATE DEACTIVATED', newValue: templateId });
  return { success: true };
}

/* =====================================================================
 * FRESH V5 EMPLOYEE TASK WORKFLOW OVERRIDES — 2026-08-20
 * - Employee board = Today Pending / Today In Progress / Previous Overdue / Today Completed
 * - Opening an employee's active task automatically starts it
 * - Task work is completed from a dedicated checklist/evidence form
 * - Tomorrow's applicable recurring task is generated only when tomorrow becomes today
 * ===================================================================== */

function employeeTaskBucket_(task, today) {
  const taskDate = dateKey_(task['TASK DATE']);
  const status = upper_(task['STATUS'] || 'PENDING');
  const finished = ['COMPLETED','COMPLETED LATE','AWAITING VERIFICATION'].indexOf(status) >= 0;
  if (!taskDate || taskDate > today) return 'FUTURE';
  if (taskDate < today) return finished ? 'HISTORY' : 'OVERDUE';
  if (finished) return 'COMPLETED';
  // V8: all unfinished work dated today remains in the employee Pending bucket.
  // Older V7 IN PROGRESS rows therefore show under Pending today or Overdue later.
  return 'PENDING';
}

function shouldEmployeeSeeTask_(task, today) {
  const bucket = employeeTaskBucket_(task, today);
  return ['PENDING','OVERDUE','COMPLETED'].indexOf(bucket) >= 0;
}

function markOverdueTasks_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return;
  const headers = data[0].map(String);
  const map = headerMap_(headers);
  const statusCol = map['STATUS'];
  const updatedCol = map['UPDATED AT'];
  if (statusCol == null) return;
  const today = todayKey_();

  for (let i = 1; i < data.length; i++) {
    const obj = rowToObj_(headers, data[i]);
    const status = upper_(obj['STATUS'] || 'PENDING');
    const taskDate = dateKey_(obj['TASK DATE']);
    if (!taskDate || taskDate >= today) continue;
    if (['PENDING','IN PROGRESS','OVERDUE','REASSIGNED','REJECTED'].indexOf(status) < 0) continue;
    if (status !== 'OVERDUE') {
      sheet.getRange(i + 1, statusCol + 1).setValue('OVERDUE');
      if (updatedCol != null) sheet.getRange(i + 1, updatedCol + 1).setValue(nowStamp_());
    }
  }
}

function listTasks(sessionToken, filters) {
  ensureTodayGenerated_();
  markOverdueTasks_();
  const actor = requireSession_(sessionToken);
  filters = filters || {};
  const today = todayKey_();
  const scope = String(filters.scope || '').trim().toUpperCase();
  const requestedUserId = String(filters.userId || '').trim();
  const department = String(filters.department || '').trim();
  const branch = String(filters.branch || '').trim();
  const status = upper_(filters.status || '');
  const priority = upper_(filters.priority || '');
  const search = String(filters.search || '').trim().toLowerCase();
  const frequency = upper_(filters.frequency || '');
  const requestedDate = String(filters.date || today);

  let tasks = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS));
  if (scope === 'MY_BOARD' || scope === 'MY_ACTIVE') {
    tasks = tasks.filter(function(r) {
      return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId && shouldEmployeeSeeTask_(r, today);
    });
  } else if (scope === 'TODAY') {
    tasks = tasks.filter(function(r) { return dateKey_(r['TASK DATE']) === today; });
    if (!canViewAllTasks_(actor)) {
      tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId; });
    } else if (requestedUserId) {
      tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === requestedUserId; });
    }
  } else if (canViewAllTasks_(actor)) {
    tasks = tasks.filter(function(r) { return dateKey_(r['TASK DATE']) === requestedDate; });
    if (requestedUserId) tasks = tasks.filter(function(r) { return String(r['CURRENT ASSIGNEE ID'] || '') === requestedUserId; });
  } else {
    tasks = tasks.filter(function(r) {
      return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId && shouldEmployeeSeeTask_(r, today);
    });
  }

  if (canViewAllTasks_(actor)) {
    if (department) tasks = tasks.filter(function(r) { return String(r['DEPARTMENT'] || '') === department; });
    if (branch) tasks = tasks.filter(function(r) { return String(r['BRANCH NAME'] || '') === branch; });
  }
  if (status) tasks = tasks.filter(function(r) { return upper_(r['STATUS']) === status; });
  if (priority) tasks = tasks.filter(function(r) { return upper_(r['PRIORITY']) === priority; });
  if (frequency) {
    const templateMap = {};
    readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES)).forEach(function(t) {
      templateMap[String(t['TASK TEMPLATE ID'] || '')] = upper_(t['FREQUENCY']);
    });
    tasks = tasks.filter(function(r) { return templateMap[String(r['TASK TEMPLATE ID'] || '')] === frequency; });
  }
  if (search) {
    tasks = tasks.filter(function(r) {
      return [r['CORE TASK'],r['TASK DESCRIPTION'],r['ORIGINAL OWNER'],r['CURRENT ASSIGNEE'],r['DEPARTMENT'],r['BRANCH NAME']]
        .join(' ').toLowerCase().indexOf(search) >= 0;
    });
  }
  return taskObjectsForClient_(tasks, actor);
}

function taskObjectsForClient_(tasks, actor) {
  const ids = {};
  tasks.forEach(function(t) { ids[String(t['TASK INSTANCE ID'] || '')] = true; });
  const grouped = {};
  readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS)).forEach(function(c) {
    const id = String(c['TASK INSTANCE ID'] || '');
    if (!ids[id]) return;
    if (!grouped[id]) grouped[id] = [];
    grouped[id].push({
      checklistInstanceId: String(c['CHECKLIST INSTANCE ID'] || ''),
      sequence: Number(c['CHECKLIST SEQUENCE'] || 0),
      text: String(c['CHECKLIST ITEM'] || ''),
      mandatory: yes_(c['MANDATORY']),
      status: upper_(c['STATUS'] || 'PENDING'),
      completedBy: String(c['COMPLETED BY'] || ''),
      completedAt: displayDateTime_(c['COMPLETED AT'])
    });
  });

  const today = todayKey_();
  tasks.sort(function(a,b) {
    const ba = employeeTaskBucket_(a, today), bb = employeeTaskBucket_(b, today);
    const order = {'PENDING':1,'OVERDUE':2,'COMPLETED':3,'HISTORY':4,'FUTURE':5};
    if ((order[ba] || 9) !== (order[bb] || 9)) return (order[ba] || 9) - (order[bb] || 9);
    const da = dateKey_(a['TASK DATE']), db = dateKey_(b['TASK DATE']);
    if (da !== db) return db.localeCompare(da);
    return timeToMinutes_(a['DUE TIME']) - timeToMinutes_(b['DUE TIME']);
  });

  return tasks.map(function(r) {
    const own = String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId;
    return {
      taskId: String(r['TASK INSTANCE ID'] || ''), templateId: String(r['TASK TEMPLATE ID'] || ''), taskDate: dateKey_(r['TASK DATE']),
      taskBucket: employeeTaskBucket_(r, today), coreTask: String(r['CORE TASK'] || ''), description: String(r['TASK DESCRIPTION'] || ''),
      department: String(r['DEPARTMENT'] || ''), branch: String(r['BRANCH NAME'] || ''), originalOwner: String(r['ORIGINAL OWNER'] || ''),
      currentAssignee: String(r['CURRENT ASSIGNEE'] || ''), currentAssigneeId: String(r['CURRENT ASSIGNEE ID'] || ''), assignmentType: String(r['ASSIGNMENT TYPE'] || ''),
      priority: upper_(r['PRIORITY'] || 'MEDIUM'), startTime: displayTime_(r['SCHEDULED START TIME']), dueTime: displayTime_(r['DUE TIME']), status: upper_(r['STATUS'] || 'PENDING'),
     workType: upper_(r['TASK TYPE'] || 'TASK'),
      checklistTotal: Number(r['CHECKLIST TOTAL'] || 0), checklistCompleted: Number(r['CHECKLIST COMPLETED'] || 0), checklistPct: Number(r['CHECKLIST PROGRESS %'] || 0),
      attachmentRequired: yes_(r['ATTACHMENT REQUIRED']), attachmentCount: Number(r['ATTACHMENT COUNT'] || 0), verificationRequired: yes_(r['VERIFICATION REQUIRED']),
      verificationStatus: upper_(r['VERIFICATION STATUS'] || ''), verifier: String(r['VERIFIER'] || ''), onTimeDelayed: upper_(r['ON TIME / DELAYED'] || ''),
      delayMinutes: Number(r['DELAY MINUTES'] || 0), remark: String(r['REMARK'] || ''), completedBy: String(r['COMPLETED BY'] || ''), completionMode: String(r['COMPLETION MODE'] || ''),
      canAct: own || canViewAllTasks_(actor), canCompleteOnBehalf: !own && canViewAllTasks_(actor),
      checklists: (grouped[String(r['TASK INSTANCE ID'] || '')] || []).sort(function(a,b) {
        if (a.sequence !== b.sequence) return a.sequence - b.sequence;
        return a.text.localeCompare(b.text);
      })
    };
  });
}

function openTaskForWork(sessionToken, taskId) {
  ensureTodayGenerated_();
  markOverdueTasks_();
  const actor = requireSession_(sessionToken);
  taskId = String(taskId || '').trim();
  if (!taskId) throw new Error('Task ID is required.');

  // V8: opening the Work Completed Form is read-only with respect to task status.
  // The task remains Pending/Overdue until the employee submits the completed form.
  const found = requireTaskActionAccess_(actor, taskId);
  return taskObjectsForClient_([found.obj], actor)[0];
}

/* =====================================================================
 * FRESH V6 PERFORMANCE + FAST INTERACTION OVERRIDES — 2026-08-20
 * - Dashboard is personal performance only; task list is not loaded there.
 * - Session bootstrap supplies cached-ready performance data in one response.
 * - Overdue marking is batched and performed at most once per calendar day.
 * - Employee checklist clicks save in one debounced batch instead of one
 *   blocking client/server round trip per checkbox.
 * ===================================================================== */

BULK_V2_TEMPLATE_VERSION = '2026-08-20-FRESH-V8';

function getSessionBootstrap(sessionToken) {
  ensureTodayGenerated_();
  markOverdueTasks_();
  const actor = requireSession_(sessionToken);
  const usersRaw = getUsersRaw_();
  const actorUser = findUserByIdRaw_(actor.userId);
  if (!actorUser) throw new Error('Your LIVE_USERS record was not found.');

  let users = [];
  if (canViewAllTasks_(actor)) users = usersRaw.filter(activeUserFilter_).map(userForClient_);
  else users = [userForClient_(actorUser)];

  return {
    today: todayKey_(),
    actor: userForClient_(actorUser),
    role: actor.role,
    permissions: permissionMap_(actor),
    users: users,
    departments: getDepartmentsForClient_(),
    branches: getBranchesForClient_(),
    dashboard: buildMyPerformanceMetricsForActor_(actor),
    notificationUnread: countUnreadNotifications_(actor.userId),
    bulkTemplateVersion: BULK_V2_TEMPLATE_VERSION
  };
}

function getMyPerformanceDashboard(sessionToken) {
  ensureTodayGenerated_();
  markOverdueTasks_();
  const actor = requireSession_(sessionToken);
  return buildMyPerformanceMetricsForActor_(actor);
}

function buildMyPerformanceMetricsForActor_(actor) {
  const today = todayKey_();
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS)).filter(function(r) {
    return String(r['CURRENT ASSIGNEE ID'] || '') === actor.userId;
  });
  const finishedStatuses = ['COMPLETED','COMPLETED LATE','AWAITING VERIFICATION'];
  const todayRows = rows.filter(function(r) { return dateKey_(r['TASK DATE']) === today; });
  const completedTodayRows = todayRows.filter(function(r) { return finishedStatuses.indexOf(upper_(r['STATUS'])) >= 0; });
  const pendingToday = todayRows.filter(function(r) { return employeeTaskBucket_(r, today) === 'PENDING'; }).length;
  const openToday = todayRows.filter(function(r) { return finishedStatuses.indexOf(upper_(r['STATUS'])) < 0; }).length;
  const overdueBacklog = rows.filter(function(r) {
    return dateKey_(r['TASK DATE']) < today && finishedStatuses.indexOf(upper_(r['STATUS'])) < 0;
  }).length;
  const awaitingVerificationToday = todayRows.filter(function(r) { return upper_(r['STATUS']) === 'AWAITING VERIFICATION'; }).length;
  const completedLateToday = todayRows.filter(function(r) { return upper_(r['STATUS']) === 'COMPLETED LATE'; }).length;
  const onTimeToday = completedTodayRows.filter(function(r) { return upper_(r['ON TIME / DELAYED']) === 'ON TIME'; }).length;

  const now = new Date();
  let isoDay = Number(Utilities.formatDate(now, APP_CONFIG.TZ, 'u'));
  if (!isoDay || isoDay < 1 || isoDay > 7) isoDay = 1;
  const weekStartDate = new Date(now.getTime() - (isoDay - 1) * 24 * 60 * 60 * 1000);
  const weekStart = Utilities.formatDate(weekStartDate, APP_CONFIG.TZ, 'yyyy-MM-dd');
  const weekRows = rows.filter(function(r) {
    const d = dateKey_(r['TASK DATE']);
    return d && d >= weekStart && d <= today;
  });
  const weekCompleted = weekRows.filter(function(r) { return finishedStatuses.indexOf(upper_(r['STATUS'])) >= 0; }).length;

  return {
    todayTotal: todayRows.length,
    completedToday: completedTodayRows.length,
    pendingToday: pendingToday,
    openToday: openToday,
    overdueBacklog: overdueBacklog,
    awaitingVerificationToday: awaitingVerificationToday,
    completedLateToday: completedLateToday,
    completionPct: todayRows.length ? Math.round(completedTodayRows.length * 100 / todayRows.length) : 0,
    onTimePct: completedTodayRows.length ? Math.round(onTimeToday * 100 / completedTodayRows.length) : 0,
    weekTotal: weekRows.length,
    weekCompleted: weekCompleted,
    weekCompletionPct: weekRows.length ? Math.round(weekCompleted * 100 / weekRows.length) : 0,
    weekStart: weekStart,
    weekStartLabel: Utilities.formatDate(weekStartDate, APP_CONFIG.TZ, 'dd MMM'),
    lastUpdatedTime: Utilities.formatDate(now, APP_CONFIG.TZ, 'hh:mm a')
  };
}

function markOverdueTasks_() {
  const props = PropertiesService.getScriptProperties();
  const today = todayKey_();
  if (props.getProperty('LAST_OVERDUE_MARK_DATE_V6') === today) return;

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (props.getProperty('LAST_OVERDUE_MARK_DATE_V6') === today) return;
    const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      props.setProperty('LAST_OVERDUE_MARK_DATE_V6', today);
      return;
    }
    const headers = data[0].map(String);
    const map = headerMap_(headers);
    const statusCol = map['STATUS'];
    const updatedCol = map['UPDATED AT'];
    if (statusCol == null) {
      props.setProperty('LAST_OVERDUE_MARK_DATE_V6', today);
      return;
    }

    const rowsToMark = [];
    for (let i = 1; i < data.length; i++) {
      const obj = rowToObj_(headers, data[i]);
      const status = upper_(obj['STATUS'] || 'PENDING');
      const taskDate = dateKey_(obj['TASK DATE']);
      if (!taskDate || taskDate >= today) continue;
      if (['PENDING','IN PROGRESS','REASSIGNED','REJECTED'].indexOf(status) < 0) continue;
      rowsToMark.push(i + 1);
    }

    if (rowsToMark.length) {
      const statusLetter = columnLetterV6_(statusCol + 1);
      sheet.getRangeList(rowsToMark.map(function(r) { return statusLetter + r; })).setValue('OVERDUE');
      if (updatedCol != null) {
        const updatedLetter = columnLetterV6_(updatedCol + 1);
        sheet.getRangeList(rowsToMark.map(function(r) { return updatedLetter + r; })).setValue(nowStamp_());
      }
    }
    props.setProperty('LAST_OVERDUE_MARK_DATE_V6', today);
  } finally {
    lock.releaseLock();
  }
}

function columnLetterV6_(n) {
  let out = '';
  n = Number(n || 0);
  while (n > 0) {
    const m = (n - 1) % 26;
    out = String.fromCharCode(65 + m) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function setChecklistStatuses(sessionToken, payload) {
  const actor = requireSession_(sessionToken);
  payload = payload || {};
  const taskId = String(payload.taskId || '').trim();
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  if (!taskId) throw new Error('Task ID is required.');
  if (!changes.length) return { success: true, completed: 0, total: 0, pct: 100 };
  if (changes.length > 100) throw new Error('Too many checklist updates in one request.');

  const taskFound = requireTaskActionAccess_(actor, taskId);
  const taskSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const checklistSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
  const data = checklistSheet.getDataRange().getValues();
  if (data.length < 2) throw new Error('Checklist data was not found.');
  const headers = data[0].map(String);
  const map = headerMap_(headers);
  const idCol = map['CHECKLIST INSTANCE ID'];
  const taskCol = map['TASK INSTANCE ID'];
  const statusCol = map['STATUS'];
  const byCol = map['COMPLETED BY'];
  const atCol = map['COMPLETED AT'];
  const updatedCol = map['UPDATED AT'];
  if ([idCol, taskCol, statusCol].some(function(v) { return v == null; })) throw new Error('Checklist sheet structure is incomplete.');

  const wanted = {};
  changes.forEach(function(ch) {
    const id = String(ch && ch.checklistId || '').trim();
    if (id) wanted[id] = !!ch.completed;
  });
  const now = nowStamp_();
  const completedRows = [];
  const pendingRows = [];
  const foundIds = {};

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][taskCol] || '') !== taskId) continue;
    const id = String(data[i][idCol] || '');
    if (!Object.prototype.hasOwnProperty.call(wanted, id)) continue;
    foundIds[id] = true;
    const completed = wanted[id];
    data[i][statusCol] = completed ? 'COMPLETED' : 'PENDING';
    if (byCol != null) data[i][byCol] = completed ? actor.name : '';
    if (atCol != null) data[i][atCol] = completed ? now : '';
    if (updatedCol != null) data[i][updatedCol] = now;
    (completed ? completedRows : pendingRows).push(i + 1);
  }

  const missing = Object.keys(wanted).filter(function(id) { return !foundIds[id]; });
  if (missing.length) throw new Error('One or more checklist items were not found. Refresh the task and try again.');

  function applyRows_(rows, colIndex, value) {
    if (!rows.length || colIndex == null) return;
    const letter = columnLetterV6_(colIndex + 1);
    checklistSheet.getRangeList(rows.map(function(r) { return letter + r; })).setValue(value);
  }
  applyRows_(completedRows, statusCol, 'COMPLETED');
  applyRows_(pendingRows, statusCol, 'PENDING');
  applyRows_(completedRows, byCol, actor.name);
  applyRows_(pendingRows, byCol, '');
  applyRows_(completedRows, atCol, now);
  applyRows_(pendingRows, atCol, '');
  applyRows_(completedRows.concat(pendingRows), updatedCol, now);

  let total = 0;
  let completedCount = 0;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][taskCol] || '') !== taskId) continue;
    total++;
    if (upper_(data[i][statusCol]) === 'COMPLETED') completedCount++;
  }
  const pct = total ? Math.round(completedCount * 100 / total) : 100;
  setObjectByRow_(taskSheet, taskFound.row, {
    'CHECKLIST TOTAL': total,
    'CHECKLIST COMPLETED': completedCount,
    'CHECKLIST PROGRESS %': pct,
    'UPDATED AT': now
  });
  auditActor_(actor, {
    taskId: taskId,
    action: 'CHECKLIST BATCH UPDATED',
    newValue: changes.length + ' item(s) updated | ' + completedCount + '/' + total + ' completed'
  });
  return { success: true, completed: completedCount, total: total, pct: pct };
}

/* =====================================================================
 * V7 SINGLE-ROW CHECKLIST STORAGE — 2026-08-20
 * - One CHECKLIST_TEMPLATES row per TASK TEMPLATE ID.
 * - One LIVE_CHECKLISTS row per TASK INSTANCE ID.
 * - Multiple checklist values are stored as aligned newline-delimited cells.
 * - Existing multi-row checklist data is automatically consolidated once.
 * - User UI still receives individual checklist items/checkboxes.
 * ===================================================================== */

var CHECKLIST_STORAGE_V7_VERSION = '2026-08-20-V7';

function splitChecklistFieldV7_(value) {
  if (value == null || value === '') return [];
  return String(value).replace(/\r/g, '').split('\n').map(function(v) { return String(v == null ? '' : v).trim(); });
}

function joinChecklistFieldV7_(values) {
  return (values || []).map(function(v) { return String(v == null ? '' : v); }).join('\n');
}

function checklistFieldAtV7_(values, index, fallback) {
  if (values && index < values.length && String(values[index] == null ? '' : values[index]) !== '') return values[index];
  return fallback == null ? '' : fallback;
}

function patchRowValuesV7_(sheet, rowNumber, obj) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  const headers = sheet.getRange(1,1,1,lastCol).getValues()[0].map(function(v) { return String(v || '').trim(); });
  const map = headerMap_(headers);
  const range = sheet.getRange(rowNumber,1,1,lastCol);
  const values = range.getValues()[0];
  Object.keys(obj || {}).forEach(function(key) {
    if (map[key] != null) values[map[key]] = obj[key];
  });
  range.setValues([values]);
}

function expandChecklistTemplateRowV7_(row, rowNumber) {
  const texts = splitChecklistFieldV7_(row['CHECKLIST ITEM']);
  const ids = splitChecklistFieldV7_(row['CHECKLIST TEMPLATE ID']);
  const seqs = splitChecklistFieldV7_(row['CHECKLIST SEQUENCE']);
  const mandatory = splitChecklistFieldV7_(row['MANDATORY']);
  const evidence = splitChecklistFieldV7_(row['EVIDENCE REQUIRED']);
  const evidenceType = splitChecklistFieldV7_(row['EVIDENCE TYPE']);
  const sourceAppIds = splitChecklistFieldV7_(row['SOURCE APP TASK ID']);
  const sourceRows = splitChecklistFieldV7_(row['SOURCE ROW ID']);
  const count = Math.max(texts.length, ids.length, seqs.length, mandatory.length, evidence.length, sourceRows.length, 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    const text = checklistFieldAtV7_(texts, i, '');
    if (!text) continue;
    out.push({
      physicalRow: rowNumber || 0,
      index: i,
      checklistTemplateId: String(checklistFieldAtV7_(ids, i, '') || ''),
      sequence: Number(checklistFieldAtV7_(seqs, i, i + 1) || (i + 1)),
      text: String(text),
      mandatory: upper_(checklistFieldAtV7_(mandatory, i, 'YES')) !== 'NO',
      evidenceRequired: upper_(checklistFieldAtV7_(evidence, i, 'NO')) === 'YES',
      evidenceType: String(checklistFieldAtV7_(evidenceType, i, '')),
      sourceAppTaskId: String(checklistFieldAtV7_(sourceAppIds, i, '')),
      sourceRowId: String(checklistFieldAtV7_(sourceRows, i, '')),
      source: String(row['SOURCE'] || ''),
      sourceKey: String(row['SOURCE KEY'] || ''),
      active: upper_(row['ACTIVE'] || 'ACTIVE') !== 'INACTIVE'
    });
  }
  return out;
}

function expandChecklistTemplateRowsV7_(rows, templateId) {
  const out = [];
  (rows || []).forEach(function(row, i) {
    if (templateId && String(row['TASK TEMPLATE ID'] || '') !== String(templateId)) return;
    if (upper_(row['ACTIVE'] || 'ACTIVE') === 'INACTIVE') return;
    expandChecklistTemplateRowV7_(row, i + 2).forEach(function(item) { out.push(item); });
  });
  out.sort(function(a,b) { return a.sequence - b.sequence || a.physicalRow - b.physicalRow || a.index - b.index; });
  return out;
}

function expandLiveChecklistRowV7_(row, rowNumber) {
  const ids = splitChecklistFieldV7_(row['CHECKLIST INSTANCE ID']);
  const templateIds = splitChecklistFieldV7_(row['CHECKLIST TEMPLATE ID']);
  const seqs = splitChecklistFieldV7_(row['CHECKLIST SEQUENCE']);
  const texts = splitChecklistFieldV7_(row['CHECKLIST ITEM']);
  const mandatory = splitChecklistFieldV7_(row['MANDATORY']);
  const statuses = splitChecklistFieldV7_(row['STATUS']);
  const completedBy = splitChecklistFieldV7_(row['COMPLETED BY']);
  const completedAt = splitChecklistFieldV7_(row['COMPLETED AT']);
  const evidence = splitChecklistFieldV7_(row['EVIDENCE REQUIRED']);
  const evidenceCount = splitChecklistFieldV7_(row['EVIDENCE COUNT']);
  const remarks = splitChecklistFieldV7_(row['REMARK']);
  const count = Math.max(ids.length, templateIds.length, seqs.length, texts.length, mandatory.length, statuses.length, 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    const text = checklistFieldAtV7_(texts, i, '');
    if (!text) continue;
    out.push({
      physicalRow: rowNumber || 0,
      index: i,
      checklistInstanceId: String(checklistFieldAtV7_(ids, i, '')),
      checklistTemplateId: String(checklistFieldAtV7_(templateIds, i, '')),
      sequence: Number(checklistFieldAtV7_(seqs, i, i + 1) || (i + 1)),
      text: String(text),
      mandatory: upper_(checklistFieldAtV7_(mandatory, i, 'YES')) !== 'NO',
      status: upper_(checklistFieldAtV7_(statuses, i, 'PENDING')),
      completedBy: String(checklistFieldAtV7_(completedBy, i, '')),
      completedAt: String(checklistFieldAtV7_(completedAt, i, '')),
      evidenceRequired: upper_(checklistFieldAtV7_(evidence, i, 'NO')) === 'YES',
      evidenceCount: Number(checklistFieldAtV7_(evidenceCount, i, 0) || 0),
      remark: String(checklistFieldAtV7_(remarks, i, ''))
    });
  }
  return out;
}

function expandLiveChecklistRowsV7_(rows, taskId) {
  const out = [];
  (rows || []).forEach(function(row, i) {
    if (taskId && String(row['TASK INSTANCE ID'] || '') !== String(taskId)) return;
    expandLiveChecklistRowV7_(row, i + 2).forEach(function(item) { out.push(item); });
  });
  out.sort(function(a,b) { return a.sequence - b.sequence || a.physicalRow - b.physicalRow || a.index - b.index; });
  return out;
}

function writeChecklistTemplatePacketV7_(sheet, rowNumber, templateId, coreTask, items, meta) {
  meta = meta || {};
  items = (items || []).slice().sort(function(a,b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
  const now = nowStamp_();
  const patch = {
    'CHECKLIST TEMPLATE ID': joinChecklistFieldV7_(items.map(function(x) { return x.checklistTemplateId || makeId_('CT'); })),
    'TASK TEMPLATE ID': templateId,
    'CORE TASK': coreTask,
    'CHECKLIST SEQUENCE': joinChecklistFieldV7_(items.map(function(x,i) { return x.sequence || i + 1; })),
    'CHECKLIST ITEM': joinChecklistFieldV7_(items.map(function(x) { return x.text; })),
    'MANDATORY': joinChecklistFieldV7_(items.map(function(x) { return x.mandatory === false ? 'NO' : 'YES'; })),
    'EVIDENCE REQUIRED': joinChecklistFieldV7_(items.map(function(x) { return x.evidenceRequired ? 'YES' : 'NO'; })),
    'EVIDENCE TYPE': joinChecklistFieldV7_(items.map(function(x) { return x.evidenceType || ''; })),
    'ACTIVE': meta.active || 'ACTIVE',
    'CREATED AT': meta.createdAt || now,
    'UPDATED AT': now,
    'SOURCE': meta.source || 'WEB APP',
    'SOURCE KEY': meta.sourceKey || '',
    'SOURCE APP TASK ID': joinChecklistFieldV7_(items.map(function(x) { return x.sourceAppTaskId || ''; })),
    'SOURCE ROW ID': joinChecklistFieldV7_(items.map(function(x) { return x.sourceRowId || ''; }))
  };
  patchRowValuesV7_(sheet, rowNumber, patch);
}

function appendChecklistTemplatePacketV7_(templateId, coreTask, checklistLines, meta) {
  checklistLines = (checklistLines || []).map(function(x) { return String(x || '').trim(); }).filter(Boolean);
  if (!checklistLines.length) return { row: 0, count: 0 };
  const sheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES);
  const now = nowStamp_();
  const items = checklistLines.map(function(text, i) {
    return { checklistTemplateId: makeId_('CT'), sequence: i + 1, text: text, mandatory: true, evidenceRequired: false, evidenceType: '', sourceRowId: '' };
  });
  appendObject_(sheet, {
    'CHECKLIST TEMPLATE ID': joinChecklistFieldV7_(items.map(function(x) { return x.checklistTemplateId; })),
    'TASK TEMPLATE ID': templateId,
    'CORE TASK': coreTask,
    'CHECKLIST SEQUENCE': joinChecklistFieldV7_(items.map(function(x) { return x.sequence; })),
    'CHECKLIST ITEM': joinChecklistFieldV7_(items.map(function(x) { return x.text; })),
    'MANDATORY': joinChecklistFieldV7_(items.map(function() { return 'YES'; })),
    'EVIDENCE REQUIRED': joinChecklistFieldV7_(items.map(function() { return 'NO'; })),
    'EVIDENCE TYPE': joinChecklistFieldV7_(items.map(function() { return ''; })),
    'ACTIVE': 'ACTIVE',
    'CREATED AT': now,
    'UPDATED AT': now,
    'SOURCE': (meta && meta.source) || 'WEB APP',
    'SOURCE KEY': (meta && meta.sourceKey) || '',
    'SOURCE ROW ID': joinChecklistFieldV7_(items.map(function() { return ''; }))
  });
  return { row: sheet.getLastRow(), count: items.length };
}

function upsertChecklistTemplatePacketV7_(templateId, coreTask, newChecklist, meta) {
  const sheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES);
  const rows = readObjects_(sheet);
  const matchingRows = [];
  rows.forEach(function(r,i) { if (String(r['TASK TEMPLATE ID'] || '') === String(templateId)) matchingRows.push({ obj:r, row:i+2 }); });
  const existing = [];
  matchingRows.forEach(function(r) { expandChecklistTemplateRowV7_(r.obj, r.row).forEach(function(x) { existing.push(x); }); });
  const seen = {};
  existing.forEach(function(x) { seen[normalizeName_(x.text)] = true; });
  let added = 0;
  (newChecklist || []).forEach(function(text, idx) {
    text = String(text || '').trim();
    const key = normalizeName_(text);
    if (!text || seen[key]) return;
    existing.push({ checklistTemplateId: makeId_('CT'), sequence: existing.length + 1, text:text, mandatory:true, evidenceRequired:false, evidenceType:'', sourceRowId:String(meta && meta.sourceRowIds && meta.sourceRowIds[idx] || '') });
    seen[key] = true;
    added++;
  });
  existing.sort(function(a,b) { return a.sequence - b.sequence; });
  existing.forEach(function(x,i) { x.sequence = i + 1; });
  if (matchingRows.length) {
    writeChecklistTemplatePacketV7_(sheet, matchingRows[0].row, templateId, coreTask, existing, {
      active:'ACTIVE', createdAt: matchingRows[0].obj['CREATED AT'] || nowStamp_(), source:(meta && meta.source) || matchingRows[0].obj['SOURCE'] || 'BULK UPLOAD', sourceKey:(meta && meta.sourceKey) || matchingRows[0].obj['SOURCE KEY'] || ''
    });
    matchingRows.slice(1).sort(function(a,b){return b.row-a.row;}).forEach(function(r){sheet.deleteRow(r.row);});
  } else if (existing.length) {
    const lines = existing.map(function(x){return x.text;});
    appendChecklistTemplatePacketV7_(templateId, coreTask, lines, meta);
    const last = sheet.getLastRow();
    const lastObj = rowToObj_(sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String), sheet.getRange(last,1,1,sheet.getLastColumn()).getValues()[0]);
    const createdItems = expandChecklistTemplateRowV7_(lastObj,last);
    createdItems.forEach(function(x,i){
      if (existing[i] && existing[i].sourceRowId) x.sourceRowId = existing[i].sourceRowId;
    });
    writeChecklistTemplatePacketV7_(sheet,last,templateId,coreTask,createdItems,{source:(meta&&meta.source)||'BULK UPLOAD',sourceKey:(meta&&meta.sourceKey)||''});
  }
  return { added:added, count:existing.length };
}

function writeLiveChecklistPacketV7_(sheet, rowNumber, taskId, templateId, coreTask, items, meta) {
  meta = meta || {};
  items = (items || []).slice().sort(function(a,b) { return Number(a.sequence || 0) - Number(b.sequence || 0); });
  const now = nowStamp_();
  patchRowValuesV7_(sheet, rowNumber, {
    'TASK INSTANCE ID': taskId,
    'CHECKLIST INSTANCE ID': joinChecklistFieldV7_(items.map(function(x) { return x.checklistInstanceId || makeId_('CI'); })),
    'TASK TEMPLATE ID': templateId,
    'CHECKLIST TEMPLATE ID': joinChecklistFieldV7_(items.map(function(x) { return x.checklistTemplateId || ''; })),
    'CORE TASK': coreTask,
    'CHECKLIST SEQUENCE': joinChecklistFieldV7_(items.map(function(x,i) { return x.sequence || i + 1; })),
    'CHECKLIST ITEM': joinChecklistFieldV7_(items.map(function(x) { return x.text; })),
    'MANDATORY': joinChecklistFieldV7_(items.map(function(x) { return x.mandatory === false ? 'NO' : 'YES'; })),
    'STATUS': joinChecklistFieldV7_(items.map(function(x) { return upper_(x.status || 'PENDING'); })),
    'COMPLETED BY': joinChecklistFieldV7_(items.map(function(x) { return x.completedBy || ''; })),
    'COMPLETED AT': joinChecklistFieldV7_(items.map(function(x) { return x.completedAt || ''; })),
    'EVIDENCE REQUIRED': joinChecklistFieldV7_(items.map(function(x) { return x.evidenceRequired ? 'YES' : 'NO'; })),
    'EVIDENCE COUNT': joinChecklistFieldV7_(items.map(function(x) { return Number(x.evidenceCount || 0); })),
    'REMARK': joinChecklistFieldV7_(items.map(function(x) { return x.remark || ''; })),
    'CREATED AT': meta.createdAt || now,
    'UPDATED AT': now
  });
}

function appendLiveChecklistPacketV7_(taskId, templateId, coreTask, templateItems, date) {
  templateItems = templateItems || [];
  if (!templateItems.length) return { count:0 };
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
  const datePart = String(date || todayKey_()).replace(/-/g,'');
  const items = templateItems.map(function(t,i) {
    const tid = t.checklistTemplateId || makeId_('CT');
    return {
      checklistInstanceId: 'CI-' + tid + '-' + datePart,
      checklistTemplateId: tid,
      sequence: t.sequence || i + 1,
      text: t.text,
      mandatory: t.mandatory !== false,
      status: 'PENDING',
      completedBy: '', completedAt: '',
      evidenceRequired: !!t.evidenceRequired,
      evidenceCount:0, remark:''
    };
  });
  appendObject_(sheet, {
    'TASK INSTANCE ID': taskId,
    'CHECKLIST INSTANCE ID': joinChecklistFieldV7_(items.map(function(x){return x.checklistInstanceId;})),
    'TASK TEMPLATE ID': templateId,
    'CHECKLIST TEMPLATE ID': joinChecklistFieldV7_(items.map(function(x){return x.checklistTemplateId;})),
    'CORE TASK': coreTask,
    'CHECKLIST SEQUENCE': joinChecklistFieldV7_(items.map(function(x){return x.sequence;})),
    'CHECKLIST ITEM': joinChecklistFieldV7_(items.map(function(x){return x.text;})),
    'MANDATORY': joinChecklistFieldV7_(items.map(function(x){return x.mandatory?'YES':'NO';})),
    'STATUS': joinChecklistFieldV7_(items.map(function(){return 'PENDING';})),
    'COMPLETED BY': joinChecklistFieldV7_(items.map(function(){return '';})),
    'COMPLETED AT': joinChecklistFieldV7_(items.map(function(){return '';})),
    'EVIDENCE REQUIRED': joinChecklistFieldV7_(items.map(function(x){return x.evidenceRequired?'YES':'NO';})),
    'EVIDENCE COUNT': joinChecklistFieldV7_(items.map(function(){return 0;})),
    'REMARK': joinChecklistFieldV7_(items.map(function(){return '';})),
    'CREATED AT': nowStamp_(),
    'UPDATED AT': nowStamp_()
  });
  return { count:items.length };
}

function migrateChecklistTemplateRowsV7_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES);
  const rows = readObjects_(sheet);
  const groups = {};
  rows.forEach(function(r,i) {
    const id = String(r['TASK TEMPLATE ID'] || '').trim();
    if (!id) return;
    if (!groups[id]) groups[id] = [];
    groups[id].push({obj:r,row:i+2});
  });
  let consolidated = 0;
  Object.keys(groups).sort(function(a,b){return groups[b][0].row-groups[a][0].row;}).forEach(function(templateId) {
    const group = groups[templateId];
    const items = [];
    group.forEach(function(g) { expandChecklistTemplateRowV7_(g.obj,g.row).forEach(function(x){items.push(x);}); });
    if (!items.length) return;
    items.sort(function(a,b){return a.sequence-b.sequence || a.physicalRow-b.physicalRow || a.index-b.index;});
    items.forEach(function(x,i){x.sequence=i+1; if(!x.checklistTemplateId)x.checklistTemplateId=makeId_('CT');});
    const first = group[0];
    writeChecklistTemplatePacketV7_(sheet, first.row, templateId, first.obj['CORE TASK'], items, {
      active:first.obj['ACTIVE'] || 'ACTIVE', createdAt:first.obj['CREATED AT'] || nowStamp_(), source:first.obj['SOURCE'] || 'WEB APP', sourceKey:first.obj['SOURCE KEY'] || ''
    });
    group.slice(1).sort(function(a,b){return b.row-a.row;}).forEach(function(g){sheet.deleteRow(g.row);});
    if (group.length > 1) consolidated += group.length - 1;
  });
  return consolidated;
}

function migrateLiveChecklistRowsV7_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS);
  const taskSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
  const rows = readObjects_(sheet);
  const groups = {};
  rows.forEach(function(r,i){const id=String(r['TASK INSTANCE ID']||'').trim();if(!id)return;if(!groups[id])groups[id]=[];groups[id].push({obj:r,row:i+2});});
  let consolidated = 0;
  Object.keys(groups).sort(function(a,b){return groups[b][0].row-groups[a][0].row;}).forEach(function(taskId){
    const group=groups[taskId], items=[];
    group.forEach(function(g){expandLiveChecklistRowV7_(g.obj,g.row).forEach(function(x){items.push(x);});});
    if(!items.length)return;
    items.sort(function(a,b){return a.sequence-b.sequence || a.physicalRow-b.physicalRow || a.index-b.index;});
    items.forEach(function(x,i){x.sequence=i+1;if(!x.checklistInstanceId)x.checklistInstanceId=makeId_('CI');});
    const first=group[0];
    writeLiveChecklistPacketV7_(sheet,first.row,taskId,first.obj['TASK TEMPLATE ID'],first.obj['CORE TASK'],items,{createdAt:first.obj['CREATED AT']||nowStamp_()});
    group.slice(1).sort(function(a,b){return b.row-a.row;}).forEach(function(g){sheet.deleteRow(g.row);});
    const taskFound=findRowById_(taskSheet,'TASK INSTANCE ID',taskId);
    if(taskFound){
      const completed=items.filter(function(x){return upper_(x.status)==='COMPLETED';}).length;
      patchRowValuesV7_(taskSheet,taskFound.row,{'CHECKLIST TOTAL':items.length,'CHECKLIST COMPLETED':completed,'CHECKLIST PROGRESS %':items.length?Math.round(completed*100/items.length):100,'UPDATED AT':nowStamp_()});
    }
    if(group.length>1)consolidated+=group.length-1;
  });
  return consolidated;
}

function migrateChecklistHistoryRowsV7_() {
  const sheet = getSheet_(APP_CONFIG.SHEETS.CHECKLIST_HISTORY);
  const rows = readObjects_(sheet);
  const groups = {};
  rows.forEach(function(r,i){const id=String(r['TASK INSTANCE ID']||'').trim();if(!id)return;if(!groups[id])groups[id]=[];groups[id].push({obj:r,row:i+2});});
  let consolidated=0;
  Object.keys(groups).sort(function(a,b){return groups[b][0].row-groups[a][0].row;}).forEach(function(taskId){
    const group=groups[taskId];
    if(group.length<2 && splitChecklistFieldV7_(group[0].obj['CHECKLIST ITEM']).length>1)return;
    const items=[];
    group.forEach(function(g){
      const r=g.obj;
      const texts=splitChecklistFieldV7_(r['CHECKLIST ITEM']);
      const ids=splitChecklistFieldV7_(r['CHECKLIST INSTANCE ID']);
      const tids=splitChecklistFieldV7_(r['CHECKLIST TEMPLATE ID']);
      const mandatory=splitChecklistFieldV7_(r['MANDATORY']);
      const statuses=splitChecklistFieldV7_(r['STATUS']);
      const by=splitChecklistFieldV7_(r['COMPLETED BY']);
      const at=splitChecklistFieldV7_(r['COMPLETED AT']);
      const ev=splitChecklistFieldV7_(r['EVIDENCE REQUIRED']);
      const ec=splitChecklistFieldV7_(r['EVIDENCE COUNT']);
      const count=Math.max(texts.length,ids.length,statuses.length,1);
      for(let i=0;i<count;i++){
        const text=checklistFieldAtV7_(texts,i,'');if(!text)continue;
        items.push({id:checklistFieldAtV7_(ids,i,''),tid:checklistFieldAtV7_(tids,i,''),text:text,mandatory:checklistFieldAtV7_(mandatory,i,'YES'),status:checklistFieldAtV7_(statuses,i,'PENDING'),by:checklistFieldAtV7_(by,i,''),at:checklistFieldAtV7_(at,i,''),ev:checklistFieldAtV7_(ev,i,'NO'),ec:checklistFieldAtV7_(ec,i,0)});
      }
    });
    if(!items.length)return;
    const first=group[0];
    patchRowValuesV7_(sheet,first.row,{
      'CHECKLIST INSTANCE ID':joinChecklistFieldV7_(items.map(function(x){return x.id;})),
      'CHECKLIST TEMPLATE ID':joinChecklistFieldV7_(items.map(function(x){return x.tid;})),
      'CHECKLIST ITEM':joinChecklistFieldV7_(items.map(function(x){return x.text;})),
      'MANDATORY':joinChecklistFieldV7_(items.map(function(x){return x.mandatory;})),
      'STATUS':joinChecklistFieldV7_(items.map(function(x){return x.status;})),
      'COMPLETED BY':joinChecklistFieldV7_(items.map(function(x){return x.by;})),
      'COMPLETED AT':joinChecklistFieldV7_(items.map(function(x){return x.at;})),
      'EVIDENCE REQUIRED':joinChecklistFieldV7_(items.map(function(x){return x.ev;})),
      'EVIDENCE COUNT':joinChecklistFieldV7_(items.map(function(x){return x.ec;}))
    });
    group.slice(1).sort(function(a,b){return b.row-a.row;}).forEach(function(g){sheet.deleteRow(g.row);});
    if(group.length>1)consolidated+=group.length-1;
  });
  return consolidated;
}


function formatChecklistPacketSheetsV7_() {
  [APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES,APP_CONFIG.SHEETS.LIVE_CHECKLISTS,APP_CONFIG.SHEETS.CHECKLIST_HISTORY].forEach(function(name){
    const sheet=getSheet_(name);
    const headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
    ['CHECKLIST ITEM','STATUS','COMPLETED BY','COMPLETED AT','CHECKLIST TEMPLATE ID','CHECKLIST INSTANCE ID'].forEach(function(h){
      const idx=headers.indexOf(h);
      if(idx<0)return;
      const rows=Math.max(sheet.getMaxRows()-1,1);
      sheet.getRange(2,idx+1,rows,1).setWrap(true).setVerticalAlignment('top');
    });
  });
}

function migrateChecklistStorageV7_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const result = {
      templateRowsRemoved:migrateChecklistTemplateRowsV7_(),
      liveRowsRemoved:migrateLiveChecklistRowsV7_(),
      historyRowsRemoved:migrateChecklistHistoryRowsV7_()
    };
    formatChecklistPacketSheetsV7_();
    const dbId=getDb_().getId();
    PropertiesService.getScriptProperties().setProperty('CHECKLIST_STORAGE_V7_MIGRATED', CHECKLIST_STORAGE_V7_VERSION+'|'+dbId);
    audit_({userName:'SYSTEM',action:'V7 CHECKLIST STORAGE MIGRATION',newValue:JSON.stringify(result)});
    return result;
  } finally {
    lock.releaseLock();
  }
}

function ensureChecklistStorageV7_() {
  const props=PropertiesService.getScriptProperties();
  const expected=CHECKLIST_STORAGE_V7_VERSION+'|'+getDb_().getId();
  if(props.getProperty('CHECKLIST_STORAGE_V7_MIGRATED')===expected)return;
  migrateChecklistStorageV7_();
}

function ensureTodayGenerated_() {
  ensureChecklistStorageV7_();
  const props=PropertiesService.getScriptProperties();
  const today=todayKey_();
  if(props.getProperty('LAST_TASK_GENERATION_DATE')!==today)generateTasksForDate_(today,'');
}

function addNewTask(sessionToken, payload) {
  ensureChecklistStorageV7_();
  const actor = requireSession_(sessionToken);
  requireTaskManager_(actor);
  payload = payload || {};
  const userId = String(payload.userId || '').trim();
  const coreTask = String(payload.coreTask || '').trim();
  const frequency = upper_(payload.frequency || 'DAILY');
  const startDate = String(payload.startDate || '').trim();
  if (!userId) throw new Error('Please select a user.');
  if (!coreTask) throw new Error('Please enter the task name.');
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error('Please select a valid task start date.');
  if (['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','ONE TIME','AS REQUIRED'].indexOf(frequency) < 0) throw new Error('Invalid task frequency.');
  const user = findUserByIdRaw_(userId);
  if (!user) throw new Error('Selected user was not found.');

  const taskType = normalizeTaskType_(payload.workType);
  const evidenceRequired = taskType === 'UPLOAD';
  const templateId = makeId_('TPL');
  const now = nowStamp_();
  const weekday = weekdayName_(startDate);
  const specificDate = ['ONE TIME','AS REQUIRED'].indexOf(frequency) >= 0 ? startDate : '';
  let detail = '';
  if (frequency === 'WEEKLY') detail = weekday;
  if (frequency === 'MONTHLY') detail = String(Number(startDate.slice(8,10)));
  if (frequency === 'QUARTERLY' || frequency === 'YEARLY') detail = startDate.slice(5);

  appendObject_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES), {
    'TASK TEMPLATE ID': templateId, 'CORE TASK': coreTask, 'TASK DESCRIPTION': String(payload.description || '').trim(),
    'DEPARTMENT': String(payload.department || user['DEPARTMENT'] || '').trim(), 'BRANCH NAME': String(user['BRANCH / LOCATION'] || '').trim(),
    'DESIGNATION / ROLE': String(user['DESIGNATION'] || '').trim(), 'DEFAULT USER': String(user['EMPLOYEE NAME'] || '').trim(), 'DEFAULT USER ID': userId,
    'TASK TYPE': taskType, 'FREQUENCY': frequency, 'FREQUENCY DETAIL': detail, 'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate,
    'TASK START DATE': startDate, 'TASK END DATE': '', 'START TIME': String(payload.startTime || '').trim(), 'DUE TIME': String(payload.dueTime || '').trim(), 'PRIORITY': upper_(payload.priority || 'MEDIUM'),
    'ATTACHMENT REQUIRED': evidenceRequired ? 'YES' : 'NO', 'ATTACHMENT TYPE': evidenceRequired ? 'FILE / PHOTO' : '',
    'VERIFICATION REQUIRED': payload.verificationRequired ? 'YES' : 'NO', 'VERIFIER': String(payload.verifier || '').trim(), 'APPROVAL REQUIRED': 'NO', 'APPROVER': '',
    'BUDDY ALLOWED': payload.buddyAllowed === false ? 'NO' : 'YES', 'ESCALATION RULE': 'PRIMARY BUDDY > SECONDARY BUDDY > MANAGER',
    'ACTIVE': 'ACTIVE', 'CREATED BY': actor.name + ' (' + actor.role + ')', 'CREATED AT': now, 'UPDATED AT': now, 'SOURCE': 'WEB APP', 'SCHEDULE STATUS': 'READY'
  });

  const checklistLines = String(payload.checklistText || '').split(/\r?\n/).map(function(s) { return s.trim(); }).filter(Boolean);
  appendChecklistTemplatePacketV7_(templateId, coreTask, checklistLines, {source:'WEB APP'});

  if (templateAppliesOnDate_({ 'FREQUENCY': frequency, 'TASK START DATE': startDate, 'SPECIFIC WEEKDAY': frequency === 'WEEKLY' ? weekday : '', 'SPECIFIC DATE': specificDate, 'FREQUENCY DETAIL': detail }, todayKey_())) {
    generateTasksForDate_(todayKey_(), templateId);
  }
  auditActor_(actor, { action: 'TASK TEMPLATE CREATED', newValue: templateId + ' | ' + coreTask + ' | Checklist ' + checklistLines.length + ' | Evidence ' + (evidenceRequired ? 'YES' : 'NO') });
  return { success: true, templateId: templateId, message: 'Task added successfully.' };
}

function upsertTaskGroupFromBulk_(group, actor) {
  ensureChecklistStorageV7_();
  const d = group.first || {};
  const user = findUserForBulkTask_(d);
  if (!user) throw new Error('Bulk task employee could not be resolved after user import.');
  const templateSheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const sourceKey = bulkTaskSourceKey_(group, user);
  const templates = readObjects_(templateSheet);
  let found = null;
  for (let i = 0; i < templates.length; i++) if (String(templates[i]['SOURCE KEY'] || '') === sourceKey) { found = {obj:templates[i],row:i+2}; break; }
  const frequency = normalizeBulkFrequency_(d['FREQUENCY']);
  const startDate = normalizeBulkDate_(d['TASK START DATE']);
  const weekday = weekdayName_(startDate);
  let detail='';
  if(frequency==='WEEKLY')detail=weekday;
  if(frequency==='MONTHLY')detail=String(Number(startDate.slice(8,10)));
  if(frequency==='QUARTERLY'||frequency==='YEARLY')detail=startDate.slice(5);
  const specificDate=['ONE TIME','AS REQUIRED'].indexOf(frequency)>=0?startDate:'';
  const templateId=found?String(found.obj['TASK TEMPLATE ID']||''):makeId_('TPL');
  const active=upper_(d['ACTIVE']||'ACTIVE')==='INACTIVE'?'INACTIVE':'ACTIVE';
  const bulkTaskType=normalizeTaskType_(d['TASK TYPE']);
  const evidenceFlag=bulkTaskType==='UPLOAD'?'YES':'NO';
  const record={
    'TASK TEMPLATE ID':templateId,'CORE TASK':String(d['CORE TASK']||'').trim(),'TASK DESCRIPTION':String(d['TASK DESCRIPTION']||'').trim(),
    'DEPARTMENT':String(d['DEPARTMENT']||user['DEPARTMENT']||'').trim(),'BRANCH NAME':String(d['BRANCH NAME']||user['BRANCH / LOCATION']||'').trim(),
    'DESIGNATION / ROLE':String(user['DESIGNATION']||'').trim(),'DEFAULT USER':String(user['EMPLOYEE NAME']||'').trim(),'DEFAULT USER ID':String(user['USER ID']||''),
    'TASK TYPE':normalizeTaskType_(d['TASK TYPE']),'FREQUENCY':frequency,'FREQUENCY DETAIL':detail,'SPECIFIC WEEKDAY':frequency==='WEEKLY'?weekday:'','SPECIFIC DATE':specificDate,
    'START TIME':normalizeBulkTime_(d['START TIME']),'DUE TIME':normalizeBulkTime_(d['DUE TIME']),'PRIORITY':upper_(d['PRIORITY']||'MEDIUM'),
    'ATTACHMENT REQUIRED':evidenceFlag,'ATTACHMENT TYPE':evidenceFlag==='YES'?'FILE / PHOTO':'','VERIFICATION REQUIRED':normalizeBulkYesNo_(d['VERIFICATION REQUIRED'],'NO'),
    'VERIFIER':String(d['VERIFIER']||'').trim(),'APPROVAL REQUIRED':'NO','APPROVER':'','BUDDY ALLOWED':normalizeBulkYesNo_(d['BUDDY ALLOWED'],'YES'),
    'ESCALATION RULE':'PRIMARY BUDDY > SECONDARY BUDDY > MANAGER','ACTIVE':active,'CREATED BY':found?String(found.obj['CREATED BY']||actor.name):actor.name+' ('+actor.role+')',
    'CREATED AT':found?(found.obj['CREATED AT']||nowStamp_()):nowStamp_(),'UPDATED AT':nowStamp_(),'TASK START DATE':startDate,'TASK END DATE':'',
    'SOURCE':'BULK UPLOAD','SOURCE KEY':sourceKey,'SOURCE CONTROL':'FRESH V7 BULK','SOURCE ROW IDS':group.rows.map(function(r){return r.rowNumber;}).join(','),'SCHEDULE STATUS':active==='ACTIVE'?'READY':'PAUSED'
  };
  if(found)patchRowValuesV7_(templateSheet,found.row,record);else appendObject_(templateSheet,record);
  const packet=upsertChecklistTemplatePacketV7_(templateId,record['CORE TASK'],group.checklist,{source:'BULK UPLOAD',sourceKey:sourceKey,sourceRowIds:group.rows.map(function(r){return r.rowNumber;})});
  let generatedToday=0;
  if(active==='ACTIVE'&&templateAppliesOnDate_(record,todayKey_())){const g=generateTasksForDate_(todayKey_(),templateId);generatedToday=Number(g&&g.created||0);}
  auditActor_(actor,{action:found?'BULK TASK TEMPLATE UPDATED':'BULK TASK TEMPLATE CREATED',newValue:templateId+' | '+record['CORE TASK']+' | Checklist '+packet.count});
  return {templateId:templateId,checklistAdded:packet.added,generatedToday:generatedToday};
}

function generateTasksForDate_(date, onlyTemplateId) {
  ensureChecklistStorageV7_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const templates = readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
    const users = getUsersRaw_();
    const availability = buildAvailabilityMap_(date);
    const liveSheet = getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS);
    const existing = readObjects_(liveSheet);
    const existingIds = new Set(existing.map(function(r) { return String(r['TASK INSTANCE ID'] || ''); }));
    const checklistTemplateRows = readObjects_(getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES));
    let created = 0;
    templates.forEach(function(t) {
      const templateId = String(t['TASK TEMPLATE ID'] || '').trim();
      if (!templateId || (onlyTemplateId && templateId !== onlyTemplateId) || upper_(t['ACTIVE'] || 'ACTIVE') !== 'ACTIVE' || !templateAppliesOnDate_(t,date)) return;
      const instanceId='INST-'+templateId+'-'+date.replace(/-/g,'');
      if(existingIds.has(instanceId))return;
      const original=findUser_(users,t['DEFAULT USER ID']||t['DEFAULT USER']);
      if(!original||isWeeklyOffOnDate_(original,date))return;
      const assignment=resolveAssignee_(original,users,availability,t,date), assignee=assignment.user||original;
      const relatedChecklist=expandChecklistTemplateRowsV7_(checklistTemplateRows,templateId);
      appendObject_(liveSheet,{
        'TASK INSTANCE ID':instanceId,'TASK TEMPLATE ID':templateId,'TASK DATE':date,'CORE TASK':t['CORE TASK'],'TASK DESCRIPTION':t['TASK DESCRIPTION'],'TASK TYPE':normalizeTaskType_(t['TASK TYPE']),
        'DEPARTMENT':t['DEPARTMENT']||original['DEPARTMENT'],'BRANCH NAME':t['BRANCH NAME']||original['BRANCH / LOCATION'],'ORIGINAL USER ID':original['USER ID'],'ORIGINAL OWNER':original['EMPLOYEE NAME'],
        'CURRENT ASSIGNEE ID':assignee['USER ID'],'CURRENT ASSIGNEE':assignee['EMPLOYEE NAME'],'ASSIGNMENT TYPE':assignment.type,'BUDDY TASK':assignment.type==='ORIGINAL'?'NO':'YES','ASSIGNED BY':'SYSTEM',
        'PRIORITY':t['PRIORITY']||'MEDIUM','SCHEDULED START TIME':t['START TIME'],'DUE TIME':t['DUE TIME'],'STATUS':'PENDING','CHECKLIST TOTAL':relatedChecklist.length,'CHECKLIST COMPLETED':0,'CHECKLIST PROGRESS %':0,
        'ATTACHMENT REQUIRED':yes_(t['ATTACHMENT REQUIRED'])?'YES':'NO','ATTACHMENT COUNT':0,'VERIFICATION REQUIRED':yes_(t['VERIFICATION REQUIRED'])?'YES':'NO','VERIFICATION STATUS':yes_(t['VERIFICATION REQUIRED'])?'PENDING':'NOT REQUIRED','VERIFIER':t['VERIFIER'],
        'APPROVAL REQUIRED':yes_(t['APPROVAL REQUIRED'])?'YES':'NO','APPROVAL STATUS':yes_(t['APPROVAL REQUIRED'])?'PENDING':'NOT REQUIRED','APPROVER':t['APPROVER'],'CREATED AT':nowStamp_(),'UPDATED AT':nowStamp_()
      });
      appendLiveChecklistPacketV7_(instanceId,templateId,t['CORE TASK'],relatedChecklist,date);
      audit_({taskId:instanceId,userName:'SYSTEM',action:'TASK GENERATED',newValue:String(t['CORE TASK']||'')+' | Checklist '+relatedChecklist.length});
      existingIds.add(instanceId);created++;
    });
    if(!onlyTemplateId&&date===todayKey_())PropertiesService.getScriptProperties().setProperty('LAST_TASK_GENERATION_DATE',date);
    return {success:true,date:date,created:created};
  } finally { lock.releaseLock(); }
}

function listTaskTemplates(sessionToken) {
  ensureChecklistStorageV7_();
  const actor=requireSession_(sessionToken);requireTaskManager_(actor);
  const rows=readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
  const checklistRows=readObjects_(getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES));
  return rows.filter(function(r){return String(r['TASK TEMPLATE ID']||'').trim();}).map(function(r){
    const id=String(r['TASK TEMPLATE ID']||'');
    const items=expandChecklistTemplateRowsV7_(checklistRows,id);
    return {templateId:id,task:String(r['CORE TASK']||''),user:String(r['DEFAULT USER']||''),userId:String(r['DEFAULT USER ID']||''),department:String(r['DEPARTMENT']||''),frequency:upper_(r['FREQUENCY']||''),startDate:dateKey_(r['TASK START DATE']),startTime:displayTime_(r['START TIME']),dueTime:displayTime_(r['DUE TIME']),priority:upper_(r['PRIORITY']||''),active:upper_(r['ACTIVE']||'ACTIVE'),scheduleStatus:upper_(r['SCHEDULE STATUS']||(r['TASK START DATE']?'READY':'NEEDS START DATE')),source:String(r['SOURCE']||'WEB APP'),control:String(r['SOURCE CONTROL']||''),checklistCount:items.length,checklistText:items.map(function(x){return x.text;}).join('\n'),workType:normalizeTaskType_(r['TASK TYPE']),evidenceRequired:yes_(r['ATTACHMENT REQUIRED']),canManageEvidence:actor.role==='SUPER ADMIN',canDeleteTemplate:isAdmin_(actor)};
  }).sort(function(a,b){return a.user.localeCompare(b.user)||a.task.localeCompare(b.task);});
}

function taskObjectsForClient_(tasks, actor) {
  ensureChecklistStorageV7_();
  const ids={};tasks.forEach(function(t){ids[String(t['TASK INSTANCE ID']||'')]=true;});
  const grouped={};
  const liveRows=readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS));
  Object.keys(ids).forEach(function(taskId){
    grouped[taskId]=expandLiveChecklistRowsV7_(liveRows,taskId).map(function(x){return {checklistInstanceId:x.checklistInstanceId,sequence:x.sequence,text:x.text,mandatory:x.mandatory,status:x.status,completedBy:x.completedBy,completedAt:x.completedAt?displayDateTime_(x.completedAt):''};});
  });
  const today=todayKey_();
  tasks.sort(function(a,b){const ba=employeeTaskBucket_(a,today),bb=employeeTaskBucket_(b,today),order={'PENDING':1,'OVERDUE':2,'COMPLETED':3,'HISTORY':4,'FUTURE':5};if((order[ba]||9)!==(order[bb]||9))return(order[ba]||9)-(order[bb]||9);const da=dateKey_(a['TASK DATE']),db=dateKey_(b['TASK DATE']);if(da!==db)return db.localeCompare(da);return timeToMinutes_(a['DUE TIME'])-timeToMinutes_(b['DUE TIME']);});
  return tasks.map(function(r){const own=String(r['CURRENT ASSIGNEE ID']||'')===actor.userId;return {taskId:String(r['TASK INSTANCE ID']||''),templateId:String(r['TASK TEMPLATE ID']||''),taskDate:dateKey_(r['TASK DATE']),taskBucket:employeeTaskBucket_(r,today),coreTask:String(r['CORE TASK']||''),description:String(r['TASK DESCRIPTION']||''),department:String(r['DEPARTMENT']||''),branch:String(r['BRANCH NAME']||''),originalOwner:String(r['ORIGINAL OWNER']||''),currentAssignee:String(r['CURRENT ASSIGNEE']||''),currentAssigneeId:String(r['CURRENT ASSIGNEE ID']||''),assignmentType:String(r['ASSIGNMENT TYPE']||''),priority:upper_(r['PRIORITY']||'MEDIUM'),startTime:displayTime_(r['SCHEDULED START TIME']),dueTime:displayTime_(r['DUE TIME']),status:upper_(r['STATUS']||'PENDING'),workType:normalizeTaskType_(r['TASK TYPE']),checklistTotal:Number(r['CHECKLIST TOTAL']||0),checklistCompleted:Number(r['CHECKLIST COMPLETED']||0),checklistPct:Number(r['CHECKLIST PROGRESS %']||0),attachmentRequired:yes_(r['ATTACHMENT REQUIRED']),attachmentCount:Number(r['ATTACHMENT COUNT']||0),verificationRequired:yes_(r['VERIFICATION REQUIRED']),verificationStatus:upper_(r['VERIFICATION STATUS']||''),verifier:String(r['VERIFIER']||''),onTimeDelayed:upper_(r['ON TIME / DELAYED']||''),delayMinutes:Number(r['DELAY MINUTES']||0),remark:String(r['REMARK']||''),completedBy:String(r['COMPLETED BY']||''),completionMode:String(r['COMPLETION MODE']||''),canAct:own||canViewAllTasks_(actor),canCompleteOnBehalf:!own&&canViewAllTasks_(actor),checklists:(grouped[String(r['TASK INSTANCE ID']||'')]||[]).sort(function(a,b){return a.sequence-b.sequence;})};});
}

function setChecklistStatuses(sessionToken, payload) {
  ensureChecklistStorageV7_();
  const actor=requireSession_(sessionToken);payload=payload||{};
  const taskId=String(payload.taskId||'').trim(),changes=Array.isArray(payload.changes)?payload.changes:[];
  if(!taskId)throw new Error('Task ID is required.');
  if(!changes.length)return {success:true,completed:0,total:0,pct:100};
  if(changes.length>100)throw new Error('Too many checklist updates in one request.');
  const taskFound=requireTaskActionAccess_(actor,taskId);
  const sheet=getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS), rows=readObjects_(sheet);
  const matching=[];rows.forEach(function(r,i){if(String(r['TASK INSTANCE ID']||'')===taskId)matching.push({obj:r,row:i+2});});
  if(!matching.length)throw new Error('Checklist data was not found.');
  const wanted={};changes.forEach(function(ch){const id=String(ch&&ch.checklistId||'').trim();if(id)wanted[id]=!!ch.completed;});
  const foundIds={},now=nowStamp_();
  matching.forEach(function(m){
    const items=expandLiveChecklistRowV7_(m.obj,m.row);
    let dirty=false;
    items.forEach(function(item){if(!Object.prototype.hasOwnProperty.call(wanted,item.checklistInstanceId))return;foundIds[item.checklistInstanceId]=true;item.status=wanted[item.checklistInstanceId]?'COMPLETED':'PENDING';item.completedBy=wanted[item.checklistInstanceId]?actor.name:'';item.completedAt=wanted[item.checklistInstanceId]?now:'';dirty=true;});
    if(dirty)writeLiveChecklistPacketV7_(sheet,m.row,taskId,m.obj['TASK TEMPLATE ID'],m.obj['CORE TASK'],items,{createdAt:m.obj['CREATED AT']||now});
  });
  const missing=Object.keys(wanted).filter(function(id){return !foundIds[id];});
  if(missing.length)throw new Error('One or more checklist items were not found. Refresh the task and try again.');
  const allItems=expandLiveChecklistRowsV7_(readObjects_(sheet),taskId);
  const total=allItems.length, completed=allItems.filter(function(x){return upper_(x.status)==='COMPLETED';}).length, pct=total?Math.round(completed*100/total):100;
  patchRowValuesV7_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS),taskFound.row,{'CHECKLIST TOTAL':total,'CHECKLIST COMPLETED':completed,'CHECKLIST PROGRESS %':pct,'UPDATED AT':now});
  auditActor_(actor,{taskId:taskId,action:'CHECKLIST BATCH UPDATED',newValue:'V7 checklist packet | '+changes.length+' item(s) updated | '+completed+'/'+total+' completed'});
  return {success:true,completed:completed,total:total,pct:pct};
}

function setChecklistStatus(sessionToken, payload) {
  payload=payload||{};
  return setChecklistStatuses(sessionToken,{taskId:payload.taskId,changes:[{checklistId:payload.checklistId,completed:!!payload.completed}]});
}

function updateTaskChecklistProgress_(taskId) {
  ensureChecklistStorageV7_();
  const rows=readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS));
  const items=expandLiveChecklistRowsV7_(rows,taskId);
  const completed=items.filter(function(x){return upper_(x.status)==='COMPLETED';}).length;
  const pct=items.length?Math.round(completed*100/items.length):100;
  const sheet=getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS),found=findRowById_(sheet,'TASK INSTANCE ID',taskId);
  if(found)patchRowValuesV7_(sheet,found.row,{'CHECKLIST TOTAL':items.length,'CHECKLIST COMPLETED':completed,'CHECKLIST PROGRESS %':pct,'UPDATED AT':nowStamp_()});
}

function completeTask(sessionToken, payload) {
  ensureChecklistStorageV7_();
  const actor=requireSession_(sessionToken);payload=payload||{};
  const taskId=String(payload.taskId||'').trim(),found=requireTaskActionAccess_(actor,taskId),task=found.obj;
  const own=String(task['CURRENT ASSIGNEE ID']||'')===actor.userId;
  if(!own&&!canViewAllTasks_(actor))throw new Error('You can only complete your own task.');
  const remark=own?'':String(payload.remark||'').trim();if(!own&&!remark)throw new Error('A follow-up/completion remark is required when completing a task on behalf of a user.');
  const checklistItems=expandLiveChecklistRowsV7_(readObjects_(getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS)),taskId);
  const mandatoryPending=checklistItems.filter(function(c){return c.mandatory&&upper_(c.status)!=='COMPLETED';});
  if(mandatoryPending.length)throw new Error('Complete all mandatory checklist items first ('+mandatoryPending.length+' pending).');
  if(yes_(task['ATTACHMENT REQUIRED'])&&Number(task['ATTACHMENT COUNT']||0)<1)throw new Error('Upload Work is required before completing this task.');
  const delay=delayMinutes_(dateKey_(task['TASK DATE']),task['DUE TIME'],new Date()),late=delay>0,verificationRequired=yes_(task['VERIFICATION REQUIRED']),newStatus=verificationRequired?'AWAITING VERIFICATION':(late?'COMPLETED LATE':'COMPLETED');
  patchRowValuesV7_(getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS),found.row,{'ACTUAL COMPLETION TIME':nowStamp_(),'STATUS':newStatus,'ON TIME / DELAYED':late?'DELAYED':'ON TIME','DELAY MINUTES':delay,'REMARK':remark,'VERIFICATION STATUS':verificationRequired?'PENDING':String(task['VERIFICATION STATUS']||'NOT REQUIRED'),'ATTACHMENT REQUIRED':yes_(task['ATTACHMENT REQUIRED'])?'YES':'NO','COMPLETED BY USER ID':actor.userId,'COMPLETED BY':actor.name,'COMPLETED BY ROLE':actor.role,'COMPLETION MODE':own?'OWN':'ON BEHALF','UPDATED AT':nowStamp_()});
  if(verificationRequired)createVerificationRecord_(taskId,found.row,task);
  auditActor_(actor,{taskId:taskId,action:own?'TASK COMPLETED':'TASK COMPLETED ON BEHALF',previousValue:upper_(task['STATUS']),newValue:newStatus+(remark?' | '+remark:'')});
  return {success:true,status:newStatus,delayMinutes:delay,completionMode:own?'OWN':'ON BEHALF'};
}

function deleteTaskTemplate(sessionToken, templateId) {
  ensureChecklistStorageV7_();
  const actor=requireSession_(sessionToken);
  requireRoles_(actor,['SUPER ADMIN','ADMIN']);
  templateId=String(templateId||'').trim();
  if(!templateId)throw new Error('Task template ID is required.');
  const templateSheet=getSheet_(APP_CONFIG.SHEETS.TEMPLATES),templateFound=findRowById_(templateSheet,'TASK TEMPLATE ID',templateId);
  if(!templateFound)throw new Error('Task template not found.');

  // PRESERVE_COMPLETED: completed/awaiting-verification live work and history are never deleted.
  const preserveStatuses=['COMPLETED','COMPLETED LATE','AWAITING VERIFICATION'];
  const liveSheet=getSheet_(APP_CONFIG.SHEETS.LIVE_TASKS),liveRows=readObjects_(liveSheet),deleteTaskRows=[],deleteTaskIds={};
  liveRows.forEach(function(r,i){if(String(r['TASK TEMPLATE ID']||'')!==templateId)return;if(preserveStatuses.indexOf(upper_(r['STATUS']))>=0)return;deleteTaskRows.push(i+2);deleteTaskIds[String(r['TASK INSTANCE ID']||'')]=true;});

  const liveChecklistSheet=getSheet_(APP_CONFIG.SHEETS.LIVE_CHECKLISTS),lcRows=readObjects_(liveChecklistSheet),lcDelete=[];
  lcRows.forEach(function(r,i){if(deleteTaskIds[String(r['TASK INSTANCE ID']||'')])lcDelete.push(i+2);});
  lcDelete.sort(function(a,b){return b-a;}).forEach(function(r){liveChecklistSheet.deleteRow(r);});

  const verificationSheet=getSheet_(APP_CONFIG.SHEETS.VERIFICATION),vRows=readObjects_(verificationSheet),vDelete=[];
  vRows.forEach(function(r,i){if(deleteTaskIds[String(r['TASK INSTANCE ID']||'')])vDelete.push(i+2);});
  vDelete.sort(function(a,b){return b-a;}).forEach(function(r){verificationSheet.deleteRow(r);});

  deleteTaskRows.sort(function(a,b){return b-a;}).forEach(function(r){liveSheet.deleteRow(r);});

  const checklistTemplateSheet=getSheet_(APP_CONFIG.SHEETS.CHECKLIST_TEMPLATES),ctRows=readObjects_(checklistTemplateSheet),ctDelete=[];
  ctRows.forEach(function(r,i){if(String(r['TASK TEMPLATE ID']||'')===templateId)ctDelete.push(i+2);});
  ctDelete.sort(function(a,b){return b-a;}).forEach(function(r){checklistTemplateSheet.deleteRow(r);});

  const taskName=String(templateFound.obj['CORE TASK']||'');
  templateSheet.deleteRow(templateFound.row);
  auditActor_(actor,{action:'TASK TEMPLATE DELETED',newValue:templateId+' | '+taskName+' | active live tasks removed '+deleteTaskRows.length+' | completed/history preserved'});
  return {success:true,templateId:templateId,task:taskName,liveTasksDeleted:deleteTaskRows.length,checklistRowsDeleted:lcDelete.length,completedPreserved:true};
}


// ===== TASK TEMPLATE EDIT (single source of truth — CHECKBOX / UPLOAD only) =====
function getTemplateForEdit(sessionToken, templateId){
  const actor = requireSession_(sessionToken); requireTaskManager_(actor);
  const rows = readObjects_(getSheet_(APP_CONFIG.SHEETS.TEMPLATES));
  const r = rows.find(x => String(x['TASK TEMPLATE ID']) === String(templateId));
  if(!r) return null;

  return {
    templateId:String(r['TASK TEMPLATE ID']||''),
    userId:String(r['DEFAULT USER ID']||''),
    user:String(r['DEFAULT USER']||''),
    department:String(r['DEPARTMENT']||''),
    task:String(r['CORE TASK']||''),
    description:String(r['TASK DESCRIPTION']||''),
    frequency:String(r['FREQUENCY']||'DAILY'),
    startDate:dateKey_(r['TASK START DATE']),
    startTime:timeValue24_(r['START TIME']),
    dueTime:timeValue24_(r['DUE TIME']),
    workType:normalizeTaskType_(r['TASK TYPE']),
    buddyAllowed:!(upper_(r['BUDDY ALLOWED'])==='NO')
  };
}

function updateTemplate(sessionToken, payload){
  const actor = requireSession_(sessionToken); requireTaskManager_(actor);
  payload = payload || {};
  const sheet = getSheet_(APP_CONFIG.SHEETS.TEMPLATES);
  const found = findRowById_(sheet,'TASK TEMPLATE ID',String(payload.templateId||''));
  if(!found) throw new Error('Template not found.');

  const taskType = normalizeTaskType_(payload.workType);
  const evidenceRequired = taskType === 'UPLOAD';

  setObjectByRow_(sheet, found.row,{
    'CORE TASK':String(payload.coreTask||''),
    'TASK DESCRIPTION':String(payload.description||''),
    'DEPARTMENT':String(payload.department||''),
    'FREQUENCY':String(payload.frequency||'DAILY'),
    'START TIME':String(payload.startTime||''),
    'DUE TIME':String(payload.dueTime||''),
    'TASK TYPE':taskType,
    'ATTACHMENT REQUIRED':evidenceRequired?'YES':'NO',
    'ATTACHMENT TYPE':evidenceRequired?'FILE / PHOTO':'',
    'BUDDY ALLOWED':payload.buddyAllowed===false?'NO':'YES',
    'UPDATED AT':nowStamp_()
  });

  auditActor_(actor,{action:'TASK TEMPLATE UPDATED',newValue:String(payload.templateId||'')+' | '+String(payload.coreTask||'')+' | Type '+taskType});
  return {success:true,message:'Task template updated successfully.'};
}
