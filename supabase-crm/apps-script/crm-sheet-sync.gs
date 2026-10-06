/**
 * MK Jewels: two-way sync between the Google Sheets CRM and the CRM project (Supabase).
 * Owner-approved design (2026-10-06): https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D
 *
 * Paste this file as a new script file into the MK JEWELS CRM SYSTEM Apps Script project (the
 * project of Code.gs and Index.html). It uses Code.gs helpers (getCrmSheet_,
 * getWalkinSourceSheet_, getReferenceNumberFromWalkinRow_, getSourceReferralsSheet_,
 * getReferralMasterSheet_, getReferralHistorySheet_, updateClientProfile, rowToHeaderMap_,
 * cleanHeader_) and changes none of them. Every name here starts with "crmss".
 * It replaces crm-walkin-push.gs: remove that file (and its trigger, sbcrmRemoveLiveSync)
 * before installing this one.
 *
 * Script Properties (Project settings > Script properties). Never paste values into chat:
 *   MK_CRM_SHEET_SYNC_URL   https://<crm-project-ref>.supabase.co/functions/v1/crm-sheet-sync
 *   MK_CRM_SHEET_SYNC_KEY   the same value as the CRM project's CRM_SHEET_SYNC_KEY secret
 *
 * Owner steps, in order:
 *   1. crmssDryRun()       counts only, writes nothing in the CRM. Run it again until the log
 *                          says "dry run complete". Review the counts.
 *   2. crmssImportRun()    the one-time import. Run it again until the log says
 *                          "import complete". Re-running is harmless.
 *   3. crmssInstallSync()  the 5-minute two-way sync.
 *   crmssPauseSync() / crmssResumeSync()   stop / restart it (needed before a Sheet rebuild).
 *
 * Rules: the Sheet wins every conflict; a row is found by its key, never by its position;
 * logs carry counts only, never names or phones.
 */

var CRMSS = {
  TABS: ['CLIENT DATABASE MASTER', 'FAMILY DATA', 'WALKIN DATASET', 'REFERRALS', 'REFERRALS CALLING MASTER', 'REFERRALS HISTORY'],
  STATE_SHEET: '_CRM_SYNC_STATE',
  DRY_RUN_SHEET: '_CRM_SYNC_DRYRUN',
  BATCH: 200,
  PULL_LIMIT: 200,
  BUDGET_MS: 4.5 * 60 * 1000,
  TZ: 'Asia/Kolkata',
  PROP_ACTIVE: 'CRMSS_ACTIVE',
  PROP_RUN: 'CRMSS_RUN_',
  STAFF_EDITOR: 'CRM WEB APP'
};

/* ------------------------------------------------------------------ */
/* Pure helpers (no Google services; tested by crm-sheet-sync.test.ts)  */
/* ------------------------------------------------------------------ */

function crmssPad_(n) { return (n < 10 ? '0' : '') + n; }

/** A cell as the CRM compares it: dates as yyyy-MM-dd (or with HH:mm:ss), text trimmed. */
function crmssCell_(value, formatDate) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value)) return '';
    var full = formatDate(value, 'yyyy-MM-dd HH:mm:ss');
    return /00:00:00$/.test(full) ? full.slice(0, 10) : full;
  }
  if (typeof value === 'number') return isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value).trim().slice(0, 5000);
}

function crmssCleanHeader_(value) {
  return String(value || '').trim().replace(/[\r\n]+/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').toUpperCase();
}

/** header -> value; a repeated header keeps its first non-empty value (Code.gs rowToHeaderMap_). */
function crmssRowValues_(headers, raw, formatDate) {
  var out = {};
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (!h) continue;
    var v = crmssCell_(raw[i], formatDate);
    if (!Object.prototype.hasOwnProperty.call(out, h) || (out[h] === '' && v !== '')) out[h] = v;
  }
  return out;
}

/** The text the fingerprint is taken over: every header in order with its value. */
function crmssHashInput_(headers, values) {
  var seen = {};
  var parts = [];
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (!h || seen[h]) continue;
    seen[h] = true;
    parts.push([h, values[h] || '']);
  }
  return JSON.stringify(parts);
}

function crmssHex_(bytes) {
  return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Code.gs referralKey_, the key the Sheet itself gives a referral. */
function crmssReferralKey_(name, number, givenBy) {
  function clean(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
  var digits = String(number || '').replace(/\D/g, '');
  var phone = digits ? digits.slice(-10) : '';
  var n = clean(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  var by = clean(givenBy).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return (phone || n || 'REF') + '|' + n + '|' + by;
}

/** Same comparison as the CRM: case and spacing do not count. */
function crmssSame_(a, b) {
  function norm(v) { return String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ').toUpperCase(); }
  return norm(a) === norm(b);
}

/** Keys for WALKIN DATASET rows: the first row keeps a reference, later rows get -R<row>. */
function crmssWalkinKeys_(refs, rowNumbers) {
  var seen = {};
  return refs.map(function (ref, i) {
    var r = String(ref || '').trim().toUpperCase();
    if (!r) return '';
    if (seen[r]) return r + '-R' + rowNumbers[i];
    seen[r] = true;
    return r;
  });
}

/**
 * Which pulled cells may be written: a cell is written only while the Sheet still holds the
 * value the CRM last saw there (the base). Returns {write: [...], skipped: [...]}.
 */
function crmssCellsToWrite_(current, change) {
  var write = [];
  var skipped = [];
  Object.keys(change.values || {}).forEach(function (col) {
    var base = change.base ? change.base[col] : '';
    if (crmssSame_(current[col], base)) write.push(col); else skipped.push(col);
  });
  return { write: write, skipped: skipped };
}

/**
 * The new row for an append, in the tab's column order. Columns whose last data row holds a
 * formula get that formula (R1C1) instead of a value; columns filled by an ARRAYFORMULA stay
 * empty. Returns {values: [...], formulas: {colIndex: r1c1}}.
 */
function crmssAppendRow_(headers, values, lastRowFormulasR1C1, arrayFormulaCols) {
  var row = [];
  var formulas = {};
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    if (arrayFormulaCols[i]) { row.push(''); continue; }
    var f = lastRowFormulasR1C1[i];
    if (f) { row.push(''); formulas[i] = f; continue; }
    row.push(h && Object.prototype.hasOwnProperty.call(values, h) ? values[h] : '');
  }
  return { values: row, formulas: formulas };
}

function crmssAdd_(counts, name, n) { counts[name] = (counts[name] || 0) + (n === undefined ? 1 : n); }

/* ------------------------------------------------------------------ */
/* Google services                                                     */
/* ------------------------------------------------------------------ */

function crmssFormatDate_(d, pattern) { return Utilities.formatDate(d, CRMSS.TZ, pattern); }

function crmssHashedKey_(prefix, raw) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return prefix + '-' + crmssHex_(bytes).slice(0, 24).toUpperCase();
}

function crmssFingerprint_(headers, values) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, crmssHashInput_(headers, values), Utilities.Charset.UTF_8);
  return crmssHex_(bytes).slice(0, 32);
}

function crmssConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('MK_CRM_SHEET_SYNC_URL');
  var key = props.getProperty('MK_CRM_SHEET_SYNC_KEY');
  if (!url || !key) throw new Error('Set MK_CRM_SHEET_SYNC_URL and MK_CRM_SHEET_SYNC_KEY first.');
  return { url: url, key: key, props: props };
}

/** One call to the CRM. Errors carry the HTTP status and the CRM's code only. */
function crmssPost_(config, body) {
  var response = UrlFetchApp.fetch(config.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-mk-sheet-sync-key': config.key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var json = {};
  try { json = JSON.parse(response.getContentText()); } catch (e) {}
  if (response.getResponseCode() !== 200 || !json.ok) {
    var code = /^[A-Z_]{1,40}$/.test(String(json.code)) ? json.code : 'UNKNOWN';
    throw new Error('CRM sync call failed: HTTP ' + response.getResponseCode() + ' ' + code);
  }
  return json;
}

function crmssFindFamilySheet_() {
  var books = [getWalkinSpreadsheet_(), getCrmSpreadsheet_()];
  for (var i = 0; i < books.length; i++) {
    var sh = books[i].getSheetByName('FAMILY DATA');
    if (sh) return sh;
  }
  return null;
}

function crmssSheetFor_(tab) {
  switch (tab) {
    case 'CLIENT DATABASE MASTER': return getCrmSheet_(CRM_CONFIG.SHEETS.MASTER);
    case 'WALKIN DATASET': return getWalkinSourceSheet_();
    case 'FAMILY DATA': return crmssFindFamilySheet_();
    case 'REFERRALS': return getSourceReferralsSheet_();
    case 'REFERRALS CALLING MASTER': return getReferralMasterSheet_();
    case 'REFERRALS HISTORY': return getReferralHistorySheet_();
  }
  return null;
}

/** Reads a tab: headers, every row's values, key and fingerprint, and key -> row number. */
function crmssReadTab_(tab) {
  var sh = crmssSheetFor_(tab);
  if (!sh) return null;
  var lastRow = sh.getLastRow();
  var lastCol = Math.max(sh.getLastColumn(), tab === 'WALKIN DATASET' ? CRM_CONFIG.SOURCE_MIN_COLS : 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(crmssCleanHeader_);
  var raws = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
  var table = { tab: tab, sheet: sh, headers: headers, lastCol: lastCol, rows: [], byKey: {}, byRow: {} };
  var walkinRefs = [];
  var walkinRows = [];

  raws.forEach(function (raw, i) {
    var rowNumber = i + 2;
    if (!raw.some(function (v) { return String(v === null || v === undefined ? '' : v).trim() !== ''; })) return;
    var values = crmssRowValues_(headers, raw, crmssFormatDate_);
    var key = '';
    if (tab === 'CLIENT DATABASE MASTER' || tab === 'FAMILY DATA') {
      key = String(values['CLIENT ID'] || '').trim().toUpperCase();
    } else if (tab === 'WALKIN DATASET') {
      if (String(values['VISIT FINAL STATUS'] || '').trim().toUpperCase() === 'DRAFT') return;
      walkinRefs.push(getReferenceNumberFromWalkinRow_({ raw: raw, rowNumber: rowNumber, map: rowToHeaderMap_(headers, raw) }));
      walkinRows.push(rowNumber);
    } else if (tab === 'REFERRALS') {
      if (!values['REFERRAL NAME'] && !values['REFERRAL NUMBER']) return;
      key = crmssHashedKey_('RK', crmssReferralKey_(values['REFERRAL NAME'], values['REFERRAL NUMBER'], values['REFERENCE GIVEN BY CLIENT NAME']));
    } else if (tab === 'REFERRALS CALLING MASTER') {
      if (!values['REFERRAL KEY']) return;
      key = crmssHashedKey_('RK', String(values['REFERRAL KEY']).trim());
    } else if (tab === 'REFERRALS HISTORY') {
      if (!values['REFERRAL KEY']) return;
      key = crmssHashedKey_('RH', String(values['REFERRAL KEY']).trim() + '|' + values['TIMESTAMP'] + '|' + String(values['NEW STATUS'] || '').trim().toUpperCase());
    }
    table.rows.push({ rowNumber: rowNumber, values: values, key: key });
  });

  if (tab === 'WALKIN DATASET') {
    var keys = crmssWalkinKeys_(walkinRefs, walkinRows);
    table.rows.forEach(function (r, i) { r.key = keys[i]; });
  }
  table.rows.forEach(function (r) {
    r.hash = crmssFingerprint_(headers, r.values);
    if (r.key && !table.byKey[r.key]) table.byKey[r.key] = r;
    table.byRow[r.rowNumber] = r;
  });
  return table;
}

/* ------------------------------------------------------------------ */
/* Fingerprint state (hidden tab in the CRM file)                      */
/* ------------------------------------------------------------------ */

function crmssStateSheet_(name) {
  var ss = getCrmSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, 3).setValues([['TAB', 'KEY', 'HASH']]);
    sh.hideSheet();
  }
  return sh;
}

function crmssReadState_(name) {
  var sh = crmssStateSheet_(name);
  var map = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      if (r[0] && r[1]) map[r[0] + '\u0001' + r[1]] = String(r[2] || '');
    });
  }
  return map;
}

function crmssWriteState_(map, name) {
  var sh = crmssStateSheet_(name);
  var rows = Object.keys(map).map(function (k) { var p = k.split('\u0001'); return [p[0], p[1], map[k]]; });
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 3).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 3).setValues(rows);
}

/* ------------------------------------------------------------------ */
/* Push (Sheet -> CRM)                                                 */
/* ------------------------------------------------------------------ */

/** Returns false when the time budget ran out before the tab was finished. */
function crmssPushTab_(config, run, table, state, dryRun, counts, started) {
  var tab = table.tab;
  var todo = table.rows.filter(function (r) { return r.key && state[tab + '\u0001' + r.key] !== r.hash; });
  for (var i = 0; i < todo.length; i += CRMSS.BATCH) {
    if (Date.now() - started > CRMSS.BUDGET_MS) return false;
    var batch = todo.slice(i, i + CRMSS.BATCH);
    var res = crmssPost_(config, {
      action: 'push', run_id: run, tab: tab, dry_run: dryRun,
      rows: batch.map(function (r) { return { key: r.key, hash: r.hash, values: r.values }; })
    });
    Object.keys(res.counts || {}).forEach(function (k) { crmssAdd_(counts, tab + ': ' + k, res.counts[k]); });
    var byKey = {};
    (res.results || []).forEach(function (r) { byKey[r.key] = r; });
    batch.forEach(function (r) {
      var result = byKey[r.key.toUpperCase()];
      // A row that failed for a passing reason is sent again next run; any other result is kept.
      if (result && !(result.outcome === 'skipped' && result.reason === 'apply_failed')) state[tab + '\u0001' + r.key] = r.hash;
    });
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Pull (CRM -> Sheet)                                                 */
/* ------------------------------------------------------------------ */

function crmssArrayFormulaCols_(sh, lastCol) {
  var top = sh.getRange(1, 1, Math.min(2, Math.max(sh.getLastRow(), 1)), lastCol).getFormulas();
  var cols = {};
  top.forEach(function (row) { row.forEach(function (f, i) { if (/ARRAYFORMULA/i.test(String(f || ''))) cols[i] = true; }); });
  return cols;
}

function crmssAppend_(table, values) {
  var sh = table.sheet;
  var lastRow = sh.getLastRow();
  var lastFormulas = lastRow >= 2 ? sh.getRange(lastRow, 1, 1, table.lastCol).getFormulasR1C1()[0] : [];
  var built = crmssAppendRow_(table.headers, values, lastFormulas, crmssArrayFormulaCols_(sh, table.lastCol));
  var target = lastRow + 1;
  sh.getRange(target, 1, 1, built.values.length).setValues([built.values]);
  Object.keys(built.formulas).forEach(function (i) { sh.getRange(target, Number(i) + 1).setFormulaR1C1(built.formulas[i]); });
  return target;
}

/** Writes only the given cells, so formulas elsewhere in the row stay formulas. */
function crmssWriteCells_(table, row, cols, values) {
  cols.forEach(function (col) {
    table.headers.forEach(function (h, i) {
      if (h === col) table.sheet.getRange(row.rowNumber, i + 1).setValue(values[col]);
    });
  });
}

/** Re-reads one written row so its new fingerprint is not pushed back as a Sheet change. */
function crmssRefreshRow_(table, rowNumber, state) {
  var raw = table.sheet.getRange(rowNumber, 1, 1, table.lastCol).getValues()[0];
  var values = crmssRowValues_(table.headers, raw, crmssFormatDate_);
  var row = table.byRow[rowNumber] || { rowNumber: rowNumber };
  row.values = values;
  row.hash = crmssFingerprint_(table.headers, values);
  table.byRow[rowNumber] = row;
  if (row.key) state[table.tab + '\u0001' + row.key] = row.hash;
  return row;
}

function crmssApplyChange_(change, tables, state) {
  var table = tables[change.tab];
  if (!table) return { id: change.id, outcome: 'failed', reason: 'tab_missing' };
  var existing = table.byKey[change.key];

  if (change.op === 'append') {
    if (existing) return { id: change.id, outcome: 'sheet_won', applied_columns: [] };
    var rowNumber = crmssAppend_(table, change.values);
    var row = crmssRefreshRow_(table, rowNumber, state);
    row.key = change.key;
    table.byKey[change.key] = row;
    state[table.tab + '\u0001' + change.key] = row.hash;
    return { id: change.id, outcome: 'applied' };
  }

  if (!existing) return { id: change.id, outcome: 'failed', reason: 'row_not_found' };
  var plan = crmssCellsToWrite_(existing.values, change);
  if (plan.write.length) {
    if (change.tab === 'CLIENT DATABASE MASTER') {
      var payload = { clientId: change.key, editedBy: CRMSS.STAFF_EDITOR };
      plan.write.forEach(function (col) { payload[col] = change.values[col]; });
      var res = updateClientProfile(payload);
      if (!res || !res.ok) return { id: change.id, outcome: 'failed', reason: 'profile_update_failed' };
    } else {
      crmssWriteCells_(table, existing, plan.write, change.values);
    }
    crmssRefreshRow_(table, existing.rowNumber, state);
  }
  return plan.skipped.length
    ? { id: change.id, outcome: 'sheet_won', applied_columns: plan.write }
    : { id: change.id, outcome: 'applied' };
}

function crmssPull_(config, tables, state, counts, started) {
  while (Date.now() - started < CRMSS.BUDGET_MS) {
    var changes = crmssPost_(config, { action: 'pull', limit: CRMSS.PULL_LIMIT }).changes || [];
    if (!changes.length) return;
    var results = changes.map(function (change) {
      try {
        if (!tables[change.tab]) tables[change.tab] = crmssReadTab_(change.tab);
        return crmssApplyChange_(change, tables, state);
      } catch (e) {
        return { id: change.id, outcome: 'failed', reason: 'sheet_write_failed' };
      }
    });
    results.forEach(function (r) { crmssAdd_(counts, 'pull: ' + r.outcome); });
    crmssPost_(config, { action: 'ack', results: results });
  }
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function crmssRun_(mode) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { console.log('CRM sheet sync: another sync is running; skipped.'); return; }
  try {
    var config = crmssConfig_();
    var props = config.props;
    var started = Date.now();
    var dryRun = mode === 'dry_run';
    var runProp = CRMSS.PROP_RUN + mode;
    var resumed = props.getProperty(runProp);
    var run = resumed ? JSON.parse(resumed) : { id: crmssPost_(config, { action: 'run_start', mode: mode }).run_id, counts: {} };
    // A dry run keeps its fingerprints in its own tab, so it never marks rows as sent.
    var stateSheet = dryRun ? CRMSS.DRY_RUN_SHEET : CRMSS.STATE_SHEET;
    var state = dryRun && !resumed ? {} : crmssReadState_(stateSheet);
    var counts = run.counts || {};
    var tables = {};
    var finished = true;

    for (var t = 0; t < CRMSS.TABS.length; t++) {
      var tab = CRMSS.TABS[t];
      var table = crmssReadTab_(tab);
      if (!table) { counts[tab + ': tab_missing'] = 1; continue; }
      tables[tab] = table;
      if (!crmssPushTab_(config, run.id, table, state, dryRun, counts, started)) { finished = false; break; }
    }
    if (finished && mode === 'live') crmssPull_(config, tables, state, counts, started);

    crmssWriteState_(state, stateSheet);
    if (!finished) {
      run.counts = counts;
      props.setProperty(runProp, JSON.stringify(run));
      console.log('CRM sheet sync ' + mode + ' paused (time limit); run it again to continue: ' + JSON.stringify(counts));
      return;
    }
    var done = crmssPost_(config, { action: 'run_finish', run_id: run.id, status: 'finished' });
    props.deleteProperty(runProp);
    if (done.crm_only !== undefined) counts['CRM clients not in the Sheet'] = done.crm_only;
    if (mode === 'live') {
      if (Object.keys(counts).some(function (k) { return !/: matched$/.test(k); })) console.log('CRM sheet sync: ' + JSON.stringify(counts));
    } else {
      console.log('CRM sheet sync ' + (dryRun ? 'dry run' : 'import') + ' complete: ' + JSON.stringify(counts));
    }
  } finally {
    lock.releaseLock();
  }
}

/** Step 1: counts only; nothing is written in the CRM. Run again until "dry run complete". */
function crmssDryRun() { crmssRun_('dry_run'); }

/** Step 2: the one-time import. Run again until "import complete". */
function crmssImportRun() { crmssRun_('import'); }

/** The 5-minute trigger. */
function crmssSync() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(CRMSS.PROP_ACTIVE) !== 'true') return;
  if (props.getProperty(CRMSS.PROP_RUN + 'import')) { console.log('CRM sheet sync: finish crmssImportRun() first.'); return; }
  crmssRun_('live');
}

/** Step 3: install the 5-minute sync. */
function crmssInstallSync() {
  crmssRemoveSync_();
  ScriptApp.newTrigger('crmssSync').timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().setProperty(CRMSS.PROP_ACTIVE, 'true');
}

function crmssRemoveSync_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'crmssSync') ScriptApp.deleteTrigger(t);
  });
}

/** Stops the sync (for example before a Sheet rebuild). */
function crmssPauseSync() {
  crmssRemoveSync_();
  PropertiesService.getScriptProperties().setProperty(CRMSS.PROP_ACTIVE, 'false');
}

/** Restarts it. */
function crmssResumeSync() { crmssInstallSync(); }

/**
 * Guard for Code.gs: add `crmssAssertSyncPaused_();` as the first line of
 * rebuildCrmFromWalkinSource, resetCrmCompletely and clearWalkinCrmClientIdsManual. Those
 * erase or renumber MKC codes, which would break the link with the CRM.
 */
function crmssAssertSyncPaused_() {
  if (PropertiesService.getScriptProperties().getProperty(CRMSS.PROP_ACTIVE) === 'true') {
    throw new Error('PAUSE CRM SYNC FIRST: run crmssPauseSync() in the MK JEWELS CRM SYSTEM script, then try again.');
  }
}
