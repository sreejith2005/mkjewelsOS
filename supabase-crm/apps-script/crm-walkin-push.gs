/**
 * SUPERSEDED (2026-10-06) by crm-sheet-sync.gs (two-way Sheet <-> CRM sync). Do not install this
 * file next to it; see docs/CRM_SHEET_SYNC_RUNBOOK.md.
 *
 * MK Jewels: WALKIN DATASET (Google Sheet "01 WALKIN DATA") -> CRM project (Supabase).
 *
 * Self-contained: paste it as a new script file into the MK JEWELS CRM SYSTEM Apps Script
 * project (or any project that can open the walk-in spreadsheet). It does not change the
 * walk-in form or any existing function; every name here starts with "sbcrm".
 *
 * Two entry points:
 *   sbcrmBackfill()          one-off history since MK_CRM_BACKFILL_SINCE (default 2026-08-17).
 *                            Resumable: run it again until the log says "done".
 *   sbcrmLiveSync()          every 5 minutes (sbcrmInstallLiveSync installs the trigger): sends
 *                            the final walk-ins of the last 3 days that were not sent yet.
 *
 * Script Properties (Project settings > Script properties). Never paste values into chat:
 *   MK_CRM_INGEST_URL              https://<crm-project-ref>.supabase.co/functions/v1/crm-walkin-ingest
 *   MK_CRM_INGEST_API_KEY          the same value as the CRM project's CRM_LEGACY_WALKIN_INGEST_API_KEY
 *   MK_CRM_WALKIN_SPREADSHEET_ID   optional; defaults to this project's walk-in source file
 *
 * Rules (same as the CRM project's ingest):
 * - The CRM saves each REFERENCE NUMBER once and also knows the numbers of the original import,
 *   so re-sending is harmless ("already ingested").
 * - A REFERENCE NUMBER that appears on more than one row: the first row keeps it, later rows
 *   are sent as "<number>-R<row>", so two real visits are never merged.
 * - A row without a REFERENCE NUMBER is sent as "AUTO-WALKIN-ROW-<row>".
 * - Drafts (VISIT FINAL STATUS = DRAFT) are never sent; they are picked up once final.
 * - The Sheet's own CRM CLIENT ID is not sent: the CRM matches clients by phone and keeps its
 *   own MKC codes.
 * - Logs carry counts only, never names or phones.
 * Owner guide: docs/CRM_SHEETS_INGEST_CUTOVER.md.
 */

var SBCRM_SHEET = 'WALKIN DATASET';
var SBCRM_SENT_PROP = 'SBCRM_SENT_RECENT';
var SBCRM_FAILED_PROP = 'SBCRM_FAILED_RECENT';
var SBCRM_LIVE_DAYS = 3;
var SBCRM_MAX_ATTEMPTS = 3;

/**
 * Sheet BRANCH value -> CRM branch name, where the two are spelled differently (checked against
 * the CRM project's active branches on 2026-10-06). Values not listed are sent as they are;
 * the CRM matches branch names case-insensitively.
 */
var SBCRM_BRANCH_ALIASES = {
  'ZAVERI BAZAR': 'Zaveri Bazaar',
  'ZAVARI BAZAR': 'Zaveri Bazaar',
  'ZAVERI BAZAAR': 'Zaveri Bazaar'
};

/* ------------------------------------------------------------------ */
/* Reading the sheet                                                   */
/* ------------------------------------------------------------------ */

function sbcrmClean_(h) {
  return String(h == null ? '' : h).replace(/[\r\n]+/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function sbcrmSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('MK_CRM_WALKIN_SPREADSHEET_ID');
  if (!id && typeof getEffectiveWalkinSpreadsheetId_ === 'function') id = getEffectiveWalkinSpreadsheetId_();
  if (!id) throw new Error('Set MK_CRM_WALKIN_SPREADSHEET_ID first.');
  var sh = SpreadsheetApp.openById(id).getSheetByName(SBCRM_SHEET);
  if (!sh) throw new Error(SBCRM_SHEET + ' sheet not found.');
  return sh;
}

/** Header name -> first column index (0-based), from the sheet's real header row. */
function sbcrmHeaderIndex_(sh) {
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var index = {};
  headers.forEach(function (h, i) {
    var key = sbcrmClean_(h);
    if (key && !(key in index)) index[key] = i;
  });
  return { index: index, lastCol: lastCol };
}

function sbcrmCol_(index, names) {
  for (var i = 0; i < names.length; i++) {
    var k = sbcrmClean_(names[i]);
    if (k in index) return index[k];
  }
  return -1;
}

function sbcrmDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) {
    return Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd');
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  var d = new Date(s);
  return isNaN(d) ? '' : Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
}

function sbcrmText_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return sbcrmDate_(v);
  return String(v).trim().slice(0, 2000);
}

function sbcrmList_(v) {
  return sbcrmText_(v).split(/\s*,\s*/).filter(function (x) { return x; }).slice(0, 40);
}

function sbcrmCols_(index) {
  return {
    timestamp: sbcrmCol_(index, ['TIMESTAMP']),
    visitDate: sbcrmCol_(index, ['CLIENT VISIT DATE', 'VISIT DATE']),
    reference: sbcrmCol_(index, ['REFERENCE NUMBER']),
    finalStatus: sbcrmCol_(index, ['VISIT FINAL STATUS'])
  };
}

/* ------------------------------------------------------------------ */
/* Row -> walk-in form fields (the field names the ingest expects)     */
/* ------------------------------------------------------------------ */

var SBCRM_FIELDS = [
  ['branch', ['BRANCH']],
  ['client_name', ['CLIENT NAME']],
  ['client_phone', ['CLIENT PHONE']],
  ['billing_phone', ['BILLING PHONE']],
  ['gender', ['GENDER']],
  ['country', ['COUNTRY']],
  ['state', ['STATE']],
  ['city', ['CITY', 'CITY (FINAL)']],
  ['city_other', ['CITY (OTHER)']],
  ['pincode', ['PINCODE']],
  ['address', ['ADDRESS']],
  ['caste', ['COMMUNITY']],
  ['caste_other', ['COMMUNITY (OTHER)']],
  ['client_potential_category', ['CLIENT POTENTIAL CATEGORY']],
  ['high_potential_reason', ['WHY IS THIS CLIENT A HIGH-POTENTIAL BUYER?']],
  ['remark', ['REMARK']],
  ['product_requirement', ['REQUIREMENTS OF CLIENT', 'PRODUCT REQUIREMENT']],
  ['crm_name', ['CRM NAME']],
  ['salesperson', ['SALESPERSON']],
  ['buy_status', ['FINAL STATUS', 'CLIENT BOUGHT ANY PRODUCT?']],
  ['not_bought_other_text', ['NOT BOUGHT REASON (OTHER TEXT)']],
  ['repair_approach', ['REPAIR/ORDER APPROACH']],
  ['new_things_choice', ['NEW THINGS CHOICE']],
  ['new_things_salesperson', ['NEW THINGS SALESPERSON']],
  ['seen_count', ['SEEN PRODUCTS COUNT']],
  ['seen_other_text', ['SEEN OTHER TEXT']],
  ['bought_count', ['BOUGHT PRODUCTS COUNT']],
  ['bought_other_text', ['BOUGHT OTHER TEXT']],
  ['order_count', ['ORDER/NEW THINGS COUNT']],
  ['order_other_text', ['ORDER/NEW THINGS OTHER TEXT']],
  ['other_order', ['OTHER ORDER']],
  ['marketing_message', ['MARKETING MESSAGE']],
  ['instagram_follow_asked', ['INSTAGRAM FOLLOW ASKED']],
  ['instagram_follow_no_reason', ['INSTAGRAM FOLLOW - NO REASON']],
  ['google_review_asked', ['GOOGLE REVIEW ASKED']],
  ['google_review_no_reason', ['GOOGLE REVIEW - NO REASON']],
  ['testimonial_asked', ['TESTIMONIAL ASKED']],
  ['testimonial_no_reason', ['TESTIMONIAL - NO REASON']],
  ['feedback_asked', ['FEEDBACK FORM ASKED']],
  ['feedback_no_reason', ['FEEDBACK FORM - NO REASON']],
  ['thankyou_note', ['THANK-YOU NOTE GIVEN']],
  ['thankyou_note_no_reason', ['THANK-YOU NOTE - NO REASON']],
  ['referrals_asked', ['REFERRALS ASKED']],
  ['referrals_no_reason', ['REFERRALS - NO REASON']],
  ['beverage', ['BEVERAGE (FINAL)', 'BEVERAGE']],
  ['beverage_other', ['BEVERAGE (OTHER)']],
  ['sugar', ['SUGAR (FINAL)', 'SUGAR']],
  ['sugar_other', ['SUGAR (OTHER)']],
  ['snack', ['SNACK (FINAL)', 'SNACK']],
  ['snack_other', ['SNACK (OTHER)']],
  ['gift_other', ['GIFT (OTHER)']],
  ['other_store_visit', ['IF CLIENT WANTS TO VISIT ANOTHER STORE', 'OTHER STORE CLIENT WANTS TO VISIT']],
  ['occupation', ['OCCUPATION']],
  ['occupation_other', ['OCCUPATION (OTHER)']],
  ['bridal_status', ['BRIDAL / NON BRIDAL']],
  ['wedding_month', ['MONTH OF WEDDING']],
  ['wedding_year', ['YEAR OF WEDDING']],
  ['communication_preference', ['COMMUNICATION PREFERENCE']],
  ['source', ['SOURCE OF LEAD']],
  ['source_other', ['SOURCE (OTHER)']],
  ['reference_name', ['REFERENCE NAME']],
  ['reference_phone', ['REFERENCE PHONE']]
];
var SBCRM_LIST_FIELDS = [
  ['seen_categories', ['SEEN CATEGORIES', 'SEEN CATEGORIES (FINAL)']],
  ['bought_categories', ['BOUGHT CATEGORIES', 'BOUGHT CATEGORIES(FINAL)']],
  ['order_categories', ['ORDER/NEW THINGS CATEGORIES', 'OTHER/ NEW PRODUCTS']],
  ['not_bought_reasons', ['NOT BOUGHT REASONS', 'NOT BOUGHT REASONS (FINAL)']],
  ['more_design_categories', ['WHICH CATEGORIES CLIENT WANT TO SEE MORE']]
];
var SBCRM_DATE_FIELDS = [
  ['visit_date', ['CLIENT VISIT DATE', 'VISIT DATE', 'TIMESTAMP']],
  ['dob', ['DOB']],
  ['anniversary', ['ANNIVERSARY']],
  ['next_visit_date', ['NEXT VISIT DATE']]
];

function sbcrmFormData_(row, index, reference) {
  var out = {};
  function pick(names, convert) {
    for (var i = 0; i < names.length; i++) {
      var c = sbcrmCol_(index, [names[i]]);
      if (c < 0) continue;
      var v = convert(row[c]);
      if (v && (!Array.isArray(v) || v.length)) return v;
    }
    return '';
  }
  SBCRM_FIELDS.forEach(function (f) { var v = pick(f[1], sbcrmText_); if (v) out[f[0]] = v; });
  SBCRM_LIST_FIELDS.forEach(function (f) { var v = pick(f[1], sbcrmList_); if (v) out[f[0]] = v; });
  SBCRM_DATE_FIELDS.forEach(function (f) { var v = pick(f[1], sbcrmDate_); if (v) out[f[0]] = v; });
  for (var n = 1; n <= 10; n++) {
    var name = pick(['COMPANION ' + n + ' NAME'], sbcrmText_);
    var phone = pick(['COMPANION ' + n + ' MOBILE'], sbcrmText_);
    var relation = pick(['COMPANION ' + n + ' RELATION'], sbcrmText_);
    if (name) out['companion_name_' + n] = name;
    if (phone) out['companion_phone_' + n] = phone;
    if (relation) out['companion_relation_' + n] = relation;
  }
  if (out.branch) {
    var alias = SBCRM_BRANCH_ALIASES[sbcrmClean_(out.branch)];
    if (alias) out.branch = alias;
  }
  out.reference_number = reference;
  return out;
}

/* ------------------------------------------------------------------ */
/* References, duplicates, drafts                                      */
/* ------------------------------------------------------------------ */

/** The key each row is sent under (see the header). refs is the REFERENCE NUMBER column. */
function sbcrmKeys_(refs) {
  var seen = {};
  return refs.map(function (r, i) {
    var row = i + 1;
    var ref = String(r[0] == null ? '' : r[0]).trim().toUpperCase();
    if (row === 1) return '';
    if (!ref) return 'AUTO-WALKIN-ROW-' + row;
    if (seen[ref]) return ref + '-R' + row;
    seen[ref] = true;
    return ref;
  });
}

function sbcrmIsDraft_(statuses, row) {
  return !!statuses && String(statuses[row - 1][0] || '').trim().toUpperCase() === 'DRAFT';
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

function sbcrmConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('MK_CRM_INGEST_URL');
  var key = props.getProperty('MK_CRM_INGEST_API_KEY');
  if (!url || !key) throw new Error('Set MK_CRM_INGEST_URL and MK_CRM_INGEST_API_KEY first.');
  return { url: url, key: key, props: props };
}

/** Returns the HTTP status and the ingest's code (never the body). */
function sbcrmSend_(config, formDataObj, backfill) {
  var headers = { 'x-mk-legacy-api-key': config.key };
  if (backfill) headers['x-mk-ingest-mode'] = 'backfill';
  var response = UrlFetchApp.fetch(config.url, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({ formDataObj: formDataObj, filesPayload: [] }),
    muteHttpExceptions: true
  });
  var code = 'UNKNOWN';
  try {
    var parsed = JSON.parse(response.getContentText()).code;
    if (/^[A-Z_]{1,40}$/.test(String(parsed))) code = String(parsed);
  } catch (e) {}
  return { status: response.getResponseCode(), code: code };
}

function sbcrmBump_(counts, name) { counts[name] = (counts[name] || 0) + 1; }

function sbcrmCount_(counts, result) {
  if (result.status === 201) sbcrmBump_(counts, 'ingested');
  else if (result.status === 200) sbcrmBump_(counts, 'already_ingested');
  else sbcrmBump_(counts, 'failed_' + result.status + '_' + result.code.toLowerCase());
}

/** Column values read once per run. */
function sbcrmColumns_(sh, cols, lastRow) {
  var dateCol = cols.visitDate >= 0 ? cols.visitDate : cols.timestamp;
  var dates = sh.getRange(1, dateCol + 1, lastRow, 1).getValues();
  return {
    keys: sbcrmKeys_(sh.getRange(1, cols.reference + 1, lastRow, 1).getValues()),
    dates: dates,
    stamps: cols.timestamp >= 0 ? sh.getRange(1, cols.timestamp + 1, lastRow, 1).getValues() : dates,
    statuses: cols.finalStatus >= 0 ? sh.getRange(1, cols.finalStatus + 1, lastRow, 1).getValues() : null
  };
}

function sbcrmRowDate_(data, row) {
  return sbcrmDate_(data.dates[row - 1][0]) || sbcrmDate_(data.stamps[row - 1][0]);
}

/* ------------------------------------------------------------------ */
/* Backfill (one-off, resumable)                                       */
/* ------------------------------------------------------------------ */

function sbcrmBackfill() {
  var config = sbcrmConfig_();
  var props = config.props;
  var since = sbcrmDate_(props.getProperty('MK_CRM_BACKFILL_SINCE') || '2026-08-17');
  var sh = sbcrmSheet_();
  var meta = sbcrmHeaderIndex_(sh);
  var cols = sbcrmCols_(meta.index);
  if (cols.reference < 0 || (cols.visitDate < 0 && cols.timestamp < 0)) throw new Error('WALKIN DATASET headers changed: REFERENCE NUMBER or the visit date not found.');
  var lastRow = sh.getLastRow();
  var data = sbcrmColumns_(sh, cols, lastRow);

  var counts = JSON.parse(props.getProperty('MK_CRM_BACKFILL_COUNTS') || '{}');
  var row = Number(props.getProperty('MK_CRM_BACKFILL_NEXT_ROW') || 2);
  var started = Date.now();

  while (row <= lastRow) {
    if (Date.now() - started > 5 * 60 * 1000) {
      props.setProperty('MK_CRM_BACKFILL_NEXT_ROW', String(row));
      props.setProperty('MK_CRM_BACKFILL_COUNTS', JSON.stringify(counts));
      console.log('CRM backfill paused at row ' + row + ' of ' + lastRow + ': ' + JSON.stringify(counts));
      return;
    }
    var date = sbcrmRowDate_(data, row);
    if (!date || date < since) { sbcrmBump_(counts, 'before_since'); row += 1; continue; }
    if (sbcrmIsDraft_(data.statuses, row)) { sbcrmBump_(counts, 'skipped_draft'); row += 1; continue; }
    var key = data.keys[row - 1];
    var values = sh.getRange(row, 1, 1, meta.lastCol).getValues()[0];
    var result = sbcrmSend_(config, sbcrmFormData_(values, meta.index, key), true);
    if (result.status === 429) { Utilities.sleep(61 * 1000); continue; } // retry the same row
    if (/-R\d+$/.test(key)) sbcrmBump_(counts, 'duplicate_reference_rows');
    if (key.indexOf('AUTO-WALKIN-ROW-') === 0) sbcrmBump_(counts, 'rows_without_reference');
    sbcrmCount_(counts, result);
    row += 1;
    Utilities.sleep(2100); // 30 requests per minute
  }
  props.setProperty('MK_CRM_BACKFILL_NEXT_ROW', String(row));
  props.setProperty('MK_CRM_BACKFILL_COUNTS', JSON.stringify(counts));
  console.log('CRM backfill done through row ' + lastRow + ': ' + JSON.stringify(counts));
}

function sbcrmResetBackfill() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('MK_CRM_BACKFILL_NEXT_ROW');
  props.deleteProperty('MK_CRM_BACKFILL_COUNTS');
}

/* ------------------------------------------------------------------ */
/* Live sync (time trigger)                                            */
/* ------------------------------------------------------------------ */

function sbcrmLiveSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var config = sbcrmConfig_();
    var props = config.props;
    var today = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    var from = Utilities.formatDate(new Date(Date.now() - SBCRM_LIVE_DAYS * 86400000), 'Asia/Kolkata', 'yyyy-MM-dd');
    var sent = JSON.parse(props.getProperty(SBCRM_SENT_PROP) || '{}');
    var failed = JSON.parse(props.getProperty(SBCRM_FAILED_PROP) || '{}');
    Object.keys(sent).forEach(function (k) { if (sent[k] < from) delete sent[k]; });
    Object.keys(failed).forEach(function (k) { if (failed[k].d < from) delete failed[k]; });

    var sh = sbcrmSheet_();
    var meta = sbcrmHeaderIndex_(sh);
    var cols = sbcrmCols_(meta.index);
    if (cols.reference < 0) throw new Error('WALKIN DATASET headers changed: REFERENCE NUMBER not found.');
    var lastRow = sh.getLastRow();
    var data = sbcrmColumns_(sh, cols, lastRow);

    var counts = {};
    var budget = 25; // stays under the ingest's 30 requests a minute
    for (var row = lastRow; row >= 2 && budget > 0; row--) {
      var date = sbcrmRowDate_(data, row);
      if (!date || date < from || date > today) continue;
      var key = data.keys[row - 1];
      if (sent[key] || sbcrmIsDraft_(data.statuses, row)) continue;
      if (failed[key] && failed[key].n >= SBCRM_MAX_ATTEMPTS) { sbcrmBump_(counts, 'gave_up'); continue; }
      var values = sh.getRange(row, 1, 1, meta.lastCol).getValues()[0];
      var result = sbcrmSend_(config, sbcrmFormData_(values, meta.index, key), false);
      budget -= 1;
      if (result.status === 429) break;
      sbcrmCount_(counts, result);
      if (result.status === 200 || result.status === 201) { sent[key] = date; delete failed[key]; }
      else failed[key] = { d: date, n: (failed[key] ? failed[key].n : 0) + 1 };
    }
    props.setProperty(SBCRM_SENT_PROP, JSON.stringify(sent));
    props.setProperty(SBCRM_FAILED_PROP, JSON.stringify(failed));
    if (Object.keys(counts).length) console.log('CRM live sync: ' + JSON.stringify(counts));
  } finally {
    lock.releaseLock();
  }
}

function sbcrmInstallLiveSync() {
  sbcrmRemoveLiveSync();
  ScriptApp.newTrigger('sbcrmLiveSync').timeBased().everyMinutes(5).create();
}

function sbcrmRemoveLiveSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sbcrmLiveSync') ScriptApp.deleteTrigger(t);
  });
}
