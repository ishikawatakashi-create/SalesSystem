/**
 * SalesSystem Phase 11 — Strikingly 問い合わせ取込 (Apps Script)
 *
 * 重要:
 * - Script Properties に secret を置く（このファイルへ直書きしない）
 * - Gmail の既読化・削除・label 変更・archive は一切しない（read-only 動作）
 * - 問い合わせ本文・メールアドレス・電話・secret を Logger に出さない
 * - backfill は自動開始しない。人間が backfillStrikinglyInquiries() を実行したときだけ
 * - partial 停止は stopBackfillByUser()（cursor/件数保持・completed にしない）
 *
 * 必要な Script Properties:
 * - SALES_SYSTEM_ENDPOINT  … https://.../api/integrations/inquiries/apps-script
 * - SALES_SYSTEM_INGEST_SECRET … SalesSystem の INQUIRY_APPS_SCRIPT_SECRET と同じ値
 * - SALES_SYSTEM_DRAFT_SECRET … SalesSystem の INQUIRY_APPS_SCRIPT_DRAFT_SECRET と同じ値（下書き用・別secret）
 * - GMAIL_LABEL（任意）… 既定 "SalesSystem/お問い合わせ"
 *
 * 下書き Web App:
 * - デプロイ: ウェブアプリ / 自分として実行 / アクセス: 全員（HMAC必須）
 * - sendEmail / reply 送信は使わない（createDraftReply のみ）
 */

var DEFAULT_LABEL = "SalesSystem/お問い合わせ";
var SEARCH_WINDOW = "newer_than:2d";
var TRIGGER_HANDLER = "syncStrikinglyInquiries";
var TRIGGER_MINUTES = 5;
var BACKFILL_PROP = "BACKFILL_PROGRESS";
/** 1 実行あたりの最大処理 message 数（Apps Script 実行時間制限対策） */
var BACKFILL_CHUNK_MESSAGES = 40;
/** GmailApp.search の 1 ページ thread 数 */
var BACKFILL_THREAD_PAGE = 20;

function getProps_() {
  var p = PropertiesService.getScriptProperties();
  return {
    endpoint: (p.getProperty("SALES_SYSTEM_ENDPOINT") || "").trim(),
    secret: (p.getProperty("SALES_SYSTEM_INGEST_SECRET") || "").trim(),
    draftSecret: (p.getProperty("SALES_SYSTEM_DRAFT_SECRET") || "").trim(),
    label: (p.getProperty("GMAIL_LABEL") || DEFAULT_LABEL).trim(),
  };
}

function toHex_(bytes) {
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i];
    if (v < 0) v += 256;
    var h = v.toString(16);
    out.push(h.length === 1 ? "0" + h : h);
  }
  return out.join("");
}

/**
 * GmailApp.getDate() は Java Date のことがあり、toISOString が無い。
 * 必ず JS Date 経由で ISO8601 にする（heartbeat の new Date() と同系統）。
 */
function toIso8601_(dateValue) {
  var ms =
    dateValue && typeof dateValue.getTime === "function"
      ? dateValue.getTime()
      : new Date(dateValue).getTime();
  if (!isFinite(ms)) {
    throw new Error("invalid_received_at");
  }
  return new Date(ms).toISOString();
}

function signRequest_(timestamp, rawBody, secret) {
  // UTF-8 を明示（日本語本文でも Node createHmac utf8 と揃える）
  var sig = Utilities.computeHmacSha256Signature(
    timestamp + "." + rawBody,
    secret,
    Utilities.Charset.UTF_8,
  );
  return toHex_(sig);
}

function safeErrorCode_(body) {
  if (!body) return null;
  var m = body.match(/"error"\s*:\s*"([a-z0-9_]+)"/);
  return m ? m[1] : null;
}

function postJson_(payload) {
  var props = getProps_();
  if (!props.endpoint || !props.secret) {
    throw new Error("missing_script_properties");
  }
  var rawBody = JSON.stringify(payload);
  var timestamp = String(Date.now());
  var signature = signRequest_(timestamp, rawBody, props.secret);
  // 文字列と同一 UTF-8 バイトを送る（署名対象と送信 body を一致させる）
  var payloadBytes = Utilities.newBlob(rawBody, "application/json").getBytes();
  var res = UrlFetchApp.fetch(props.endpoint, {
    method: "post",
    contentType: "application/json; charset=UTF-8",
    payload: payloadBytes,
    headers: {
      "X-SalesSystem-Timestamp": timestamp,
      "X-SalesSystem-Signature": signature,
    },
    muteHttpExceptions: true,
  });
  var text = res.getContentText() || "";
  return {
    code: res.getResponseCode(),
    body: text,
    error: safeErrorCode_(text),
  };
}

var MAX_HTML_CHARS_ = 100000;

function hasLabelSentinel_(body, label) {
  var re = new RegExp(
    "(^|\\n)\\s*" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:：]?\\s*($|\\n)",
    "i",
  );
  return re.test(String(body || ""));
}

/** plain 行 or HTML 断片のどちらでも label 文字が含まれるか（transport 候補用） */
function bodyHasLabelHint_(body, label) {
  if (hasLabelSentinel_(body, label)) return true;
  return String(body || "").indexOf(label) !== -1;
}

/**
 * Apps Script 側の軽い候補判定（最終判定は server）。
 * Re/Fwd と非元通知は送らない。From 単独では判定しない。
 */
function isStrikinglyCandidate_(subject, from, body) {
  var s = String(subject || "").trim();
  if (!s) return false;
  if (/^(re|fw|fwd)\s*:/i.test(s)) return false;
  if (!/^.+\sはあなたのサイトにコメントしました\s*$/.test(s)) return false;
  var required = [
    "カスタムフォーム",
    "お問い合わせ種別",
    "名",
    "メールアドレス",
    "お問い合わせ内容",
  ];
  for (var i = 0; i < required.length; i++) {
    if (!bodyHasLabelHint_(body, required[i])) return false;
  }
  return true;
}

function truncate_(text, maxChars) {
  var s = String(text || "");
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars);
}

function buildInquiryPayload_(msg, historical) {
  var plain = "";
  var html = "";
  try {
    plain = msg.getPlainBody() || "";
  } catch (e1) {
    plain = "";
  }
  try {
    html = msg.getBody() || "";
  } catch (e2) {
    html = "";
  }
  // plain に sentinel が無いとき HTML 側も候補判定に使う
  var gateBody = plain;
  if (!hasLabelSentinel_(plain, "お問い合わせ内容") && html) {
    gateBody = html;
  }
  return {
    source: "strikingly_email",
    gmail_message_id: String(msg.getId()),
    gmail_thread_id: String(msg.getThread().getId()),
    received_at: toIso8601_(msg.getDate()),
    from: msg.getFrom() || null,
    reply_to: msg.getReplyTo() || null,
    subject: msg.getSubject() || null,
    plain_body: plain || null,
    html_body: html ? truncate_(html, MAX_HTML_CHARS_) : null,
    historical_import: !!historical,
    _gate_body: gateBody,
  };
}

function classifyResponse_(code, body) {
  if (code >= 200 && code < 300) {
    if (body.indexOf('"skipped"') !== -1) return "skipped";
    if (body.indexOf('"duplicate"') !== -1) return "duplicate";
    if (body.indexOf('"updated"') !== -1) return "accepted";
    if (body.indexOf('"accepted"') !== -1) return "accepted";
    return "accepted";
  }
  if (code === 400) return "failed_validation";
  return "failed_retryable";
}

function stripInternalPayloadFields_(payload) {
  var out = {};
  var keys = Object.keys(payload);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (k.charAt(0) === "_") continue;
    out[k] = payload[k];
  }
  return out;
}

function emptyHttpCounters_() {
  return {
    http_2xx: 0,
    http_400: 0,
    http_401: 0,
    http_429: 0,
    http_5xx: 0,
    http_other: 0,
    local_throw: 0,
    last_error: null,
  };
}

function noteHttp_(counters, code, errorCode) {
  if (code >= 200 && code < 300) counters.http_2xx++;
  else if (code === 400) counters.http_400++;
  else if (code === 401) counters.http_401++;
  else if (code === 429) counters.http_429++;
  else if (code >= 500 && code < 600) counters.http_5xx++;
  else counters.http_other++;
  if (errorCode) counters.last_error = errorCode;
}

function logPollSummary_(mode, processed, success, duplicate, skipped, failed, counters) {
  Logger.log(
    "mode=" +
      mode +
      " processed=" +
      processed +
      " success=" +
      success +
      " duplicate=" +
      duplicate +
      " skipped=" +
      skipped +
      " failed=" +
      failed +
      " http_2xx=" +
      counters.http_2xx +
      " http_400=" +
      counters.http_400 +
      " http_401=" +
      counters.http_401 +
      " http_429=" +
      counters.http_429 +
      " http_5xx=" +
      counters.http_5xx +
      " http_other=" +
      counters.http_other +
      " local_throw=" +
      counters.local_throw +
      " reason=" +
      (counters.last_error || "none"),
  );
}

/**
 * Gmail 専用 label の直近メッセージを取得し SalesSystem へ POST。
 * installable time-driven trigger から呼ばれる（通常運用）。
 */
function syncStrikinglyInquiries() {
  var props = getProps_();
  if (!props.endpoint || !props.secret) {
    Logger.log("status=config_error reason=missing_properties");
    return;
  }

  var label = GmailApp.getUserLabelByName(props.label);
  if (!label) {
    Logger.log("status=stopped reason=label_missing");
    return;
  }

  var query =
    'label:"' + props.label.replace(/"/g, "") + '" ' + SEARCH_WINDOW;
  var threads = GmailApp.search(query, 0, 50);

  var processed = 0;
  var success = 0;
  var duplicate = 0;
  var skipped = 0;
  var failed = 0;
  var counters = emptyHttpCounters_();

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      processed++;
      var subject = msg.getSubject() || "";
      var from = msg.getFrom() || "";
      var payload;
      try {
        payload = buildInquiryPayload_(msg, false);
      } catch (buildErr) {
        failed++;
        counters.local_throw++;
        counters.last_error = "payload_build_failed";
        continue;
      }
      if (!isStrikinglyCandidate_(subject, from, payload._gate_body)) {
        skipped++;
        continue;
      }

      try {
        var res = postJson_(stripInternalPayloadFields_(payload));
        noteHttp_(counters, res.code, res.error);
        var kind = classifyResponse_(res.code, res.body);
        if (kind === "accepted") success++;
        else if (kind === "duplicate") duplicate++;
        else if (kind === "skipped") skipped++;
        else failed++;
      } catch (e) {
        failed++;
        counters.local_throw++;
        counters.last_error = "local_throw";
      }
    }
  }

  logPollSummary_(
    "poll",
    processed,
    success,
    duplicate,
    skipped,
    failed,
    counters,
  );

  try {
    postJson_({ type: "heartbeat", timestamp: new Date().toISOString() });
  } catch (e2) {
    Logger.log("heartbeat=failed");
  }
}

/** 1日1回でも可。手動実行用 */
function sendHeartbeat() {
  var res = postJson_({
    type: "heartbeat",
    timestamp: new Date().toISOString(),
  });
  Logger.log("heartbeat_http=" + res.code);
}

/**
 * 5分ごとの installable trigger を登録。
 * 同名 handler の既存 trigger は削除してから作り直す。
 * backfill は登録しない。
 */
function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger(TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(TRIGGER_MINUTES)
    .create();
  Logger.log("trigger=created everyMinutes=" + TRIGGER_MINUTES);
}

function defaultBackfillProgress_() {
  return {
    status: "paused",
    thread_offset: 0,
    processed: 0,
    accepted: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
    completed: false,
    stopped_reason: null,
  };
}

function loadBackfillProgress_() {
  var raw = PropertiesService.getScriptProperties().getProperty(BACKFILL_PROP);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveBackfillProgress_(progress) {
  PropertiesService.getScriptProperties().setProperty(
    BACKFILL_PROP,
    JSON.stringify(progress),
  );
}

/**
 * 過去問い合わせ backfill（手動実行のみ。自動開始しない）。
 * 1 回の実行で BACKFILL_CHUNK_MESSAGES 件まで処理し、続きは次回実行で再開。
 */
function backfillStrikinglyInquiries() {
  var props = getProps_();
  if (!props.endpoint || !props.secret) {
    Logger.log("backfill=config_error reason=missing_properties");
    return;
  }

  var label = GmailApp.getUserLabelByName(props.label);
  if (!label) {
    Logger.log("backfill=stopped reason=label_missing");
    return;
  }

  var progress = loadBackfillProgress_() || defaultBackfillProgress_();
  if (progress.completed || progress.status === "completed") {
    Logger.log(
      "backfill=already_completed processed=" +
        progress.processed +
        " accepted=" +
        progress.accepted +
        " duplicate=" +
        progress.duplicate +
        " skipped=" +
        progress.skipped +
        " failed=" +
        progress.failed,
    );
    return;
  }

  // paused / stopped_by_user / 旧 running から再開可。実行中のみ running。
  progress.status = "running";
  progress.completed = false;
  progress.stopped_reason = null;

  var query = 'label:"' + props.label.replace(/"/g, "") + '"';
  var threads = GmailApp.search(
    query,
    progress.thread_offset || 0,
    BACKFILL_THREAD_PAGE,
  );

  if (!threads.length) {
    progress.status = "completed";
    progress.completed = true;
    saveBackfillProgress_(progress);
    Logger.log(
      "backfill=completed processed=" +
        progress.processed +
        " accepted=" +
        progress.accepted +
        " duplicate=" +
        progress.duplicate +
        " skipped=" +
        progress.skipped +
        " failed=" +
        progress.failed,
    );
    return;
  }

  var messagesThisRun = 0;
  var stopEarly = false;
  var threadsFullyHandled = 0;

  for (var i = 0; i < threads.length; i++) {
    if (stopEarly) break;
    var messages = threads[i].getMessages();
    var threadOk = true;
    for (var j = 0; j < messages.length; j++) {
      if (messagesThisRun >= BACKFILL_CHUNK_MESSAGES) {
        stopEarly = true;
        threadOk = false;
        break;
      }
      var msg = messages[j];
      messagesThisRun++;
      progress.processed = (progress.processed || 0) + 1;

      var subject = msg.getSubject() || "";
      var from = msg.getFrom() || "";
      var bfPayload;
      try {
        bfPayload = buildInquiryPayload_(msg, true);
      } catch (bfBuildErr) {
        progress.failed = (progress.failed || 0) + 1;
        threadOk = false;
        stopEarly = true;
        break;
      }
      if (!isStrikinglyCandidate_(subject, from, bfPayload._gate_body)) {
        progress.skipped = (progress.skipped || 0) + 1;
        continue;
      }

      try {
        var res = postJson_(stripInternalPayloadFields_(bfPayload));
        var kind = classifyResponse_(res.code, res.body);
        if (kind === "accepted") {
          progress.accepted = (progress.accepted || 0) + 1;
        } else if (kind === "duplicate") {
          progress.duplicate = (progress.duplicate || 0) + 1;
        } else if (kind === "skipped") {
          progress.skipped = (progress.skipped || 0) + 1;
        } else if (kind === "failed_retryable") {
          // 429/5xx: この thread から次回再試行（offset を進めない）
          progress.failed = (progress.failed || 0) + 1;
          threadOk = false;
          stopEarly = true;
          break;
        } else {
          progress.failed = (progress.failed || 0) + 1;
        }
      } catch (e) {
        progress.failed = (progress.failed || 0) + 1;
        threadOk = false;
        stopEarly = true;
        break;
      }
    }
    if (threadOk) {
      threadsFullyHandled++;
    } else {
      break;
    }
  }

  progress.thread_offset =
    (progress.thread_offset || 0) + threadsFullyHandled;

  if (!stopEarly && threads.length < BACKFILL_THREAD_PAGE) {
    progress.status = "completed";
    progress.completed = true;
    progress.stopped_reason = null;
  } else {
    // 実処理終了後は paused（running のまま残さない）
    progress.status = "paused";
    progress.completed = false;
  }

  saveBackfillProgress_(progress);

  Logger.log(
    "backfill=" +
      progress.status +
      " chunk_messages=" +
      messagesThisRun +
      " thread_offset=" +
      progress.thread_offset +
      " processed=" +
      progress.processed +
      " accepted=" +
      progress.accepted +
      " duplicate=" +
      progress.duplicate +
      " skipped=" +
      progress.skipped +
      " failed=" +
      progress.failed +
      " completed=" +
      progress.completed,
  );
}

/**
 * 人間判断で partial backfill を停止する。
 * cursor / 件数は保持。completed=true にはしない。通常 polling には影響しない。
 * 旧 status=running の取り残しにも使う。
 */
function stopBackfillByUser() {
  var progress = loadBackfillProgress_();
  if (!progress) {
    Logger.log('backfill=stop_noop reason=no_progress status=idle');
    return;
  }
  if (progress.completed || progress.status === "completed") {
    Logger.log(
      "backfill=already_completed processed=" +
        (progress.processed || 0) +
        " accepted=" +
        (progress.accepted || 0),
    );
    return;
  }
  progress.status = "stopped_by_user";
  progress.completed = false;
  progress.stopped_reason = "human_partial_stop";
  saveBackfillProgress_(progress);
  Logger.log(
    "backfill=stopped_by_user" +
      " thread_offset=" +
      (progress.thread_offset || 0) +
      " processed=" +
      (progress.processed || 0) +
      " accepted=" +
      (progress.accepted || 0) +
      " duplicate=" +
      (progress.duplicate || 0) +
      " skipped=" +
      (progress.skipped || 0) +
      " failed=" +
      (progress.failed || 0) +
      " completed=false",
  );
}

/** progress 確認（PII なし） */
function getBackfillStatus() {
  var progress = loadBackfillProgress_();
  if (!progress) {
    Logger.log('backfill_status={"status":"idle","completed":false}');
    return;
  }
  Logger.log(
    "backfill_status=" +
      JSON.stringify({
        status: progress.status,
        processed: progress.processed || 0,
        accepted: progress.accepted || 0,
        duplicate: progress.duplicate || 0,
        skipped: progress.skipped || 0,
        failed: progress.failed || 0,
        completed: !!progress.completed,
        thread_offset: progress.thread_offset || 0,
        stopped_reason: progress.stopped_reason || null,
      }),
  );
}

/** 完了後に再 backfill する場合のみ。通常は不要。cursor を消すので日常停止には使わない */
function resetBackfillProgress() {
  PropertiesService.getScriptProperties().deleteProperty(BACKFILL_PROP);
  Logger.log("backfill=reset");
}

/**
 * 設定確認（secret 値は表示しない）
 */
function checkConfiguration() {
  var props = getProps_();
  var label = props.label
    ? GmailApp.getUserLabelByName(props.label)
    : null;
  var hasTrigger = false;
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === TRIGGER_HANDLER) {
      hasTrigger = true;
      break;
    }
  }
  var bf = loadBackfillProgress_();

  Logger.log(
    JSON.stringify({
      endpoint_set: !!props.endpoint,
      endpoint_looks_https: props.endpoint.indexOf("https://") === 0,
      secret_set: !!props.secret,
      secret_length_ok: props.secret.length >= 16,
      draft_secret_set: !!props.draftSecret,
      draft_secret_length_ok: props.draftSecret.length >= 16,
      label_name: props.label,
      label_exists: !!label,
      trigger_exists: hasTrigger,
      search_window: SEARCH_WINDOW,
      backfill_status: bf
        ? {
            status: bf.status,
            processed: bf.processed || 0,
            accepted: bf.accepted || 0,
            duplicate: bf.duplicate || 0,
            skipped: bf.skipped || 0,
            failed: bf.failed || 0,
            completed: !!bf.completed,
            thread_offset: bf.thread_offset || 0,
            stopped_reason: bf.stopped_reason || null,
          }
        : { status: "idle", completed: false },
    }),
  );
}

// ---------- Gmail draft Web App (HMAC envelope) ----------

var DRAFT_MAX_SKEW_MS_ = 5 * 60 * 1000;
var DRAFT_NONCE_PROP_ = "DRAFT_USED_NONCES";

function jsonResponse_(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function verifyDraftEnvelope_(envelope, secret) {
  if (!envelope || typeof envelope !== "object") {
    return { ok: false, reason: "invalid_envelope" };
  }
  var ts = String(envelope.timestamp || "").trim();
  var nonce = String(envelope.nonce || "").trim();
  var payloadB64 = String(envelope.payload_b64 || "").trim();
  var signature = String(envelope.signature || "").trim().toLowerCase();
  if (!ts) return { ok: false, reason: "missing_timestamp" };
  if (!nonce) return { ok: false, reason: "missing_nonce" };
  if (!payloadB64) return { ok: false, reason: "missing_payload" };
  if (!signature) return { ok: false, reason: "missing_signature" };

  var t = Number(ts);
  if (!isFinite(t)) return { ok: false, reason: "stale_timestamp" };
  var ms = t < 1e12 ? t * 1000 : t;
  if (Math.abs(Date.now() - ms) > DRAFT_MAX_SKEW_MS_) {
    return { ok: false, reason: "stale_timestamp" };
  }

  var expected = toHex_(
    Utilities.computeHmacSha256Signature(
      ts + "." + nonce + "." + payloadB64,
      secret,
      Utilities.Charset.UTF_8,
    ),
  );
  if (expected !== signature) return { ok: false, reason: "invalid_signature" };

  // nonce replay（Script Properties に短時間保持）
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(DRAFT_NONCE_PROP_) || "{}";
  var map = {};
  try {
    map = JSON.parse(raw) || {};
  } catch (e) {
    map = {};
  }
  var now = Date.now();
  Object.keys(map).forEach(function (k) {
    if (now - Number(map[k]) > DRAFT_MAX_SKEW_MS_ * 2) delete map[k];
  });
  if (map[nonce]) return { ok: false, reason: "replay_nonce" };
  map[nonce] = now;
  props.setProperty(DRAFT_NONCE_PROP_, JSON.stringify(map));
  return { ok: true };
}

function decodePayloadB64_(b64) {
  var bytes = Utilities.base64Decode(b64);
  var text = Utilities.newBlob(bytes).getDataAsString("UTF-8");
  return JSON.parse(text);
}

function listSendAsAddresses_() {
  var primary = Session.getActiveUser().getEmail();
  var aliases = GmailApp.getAliases() || [];
  var all = [];
  if (primary) all.push(String(primary));
  for (var i = 0; i < aliases.length; i++) {
    var a = String(aliases[i] || "").trim();
    if (a && all.indexOf(a) === -1) all.push(a);
  }
  return { primary: primary || null, aliases: all };
}

function createReplyDraft_(payload) {
  var messageId = String(payload.gmail_message_id || "").trim();
  var from = String(payload.from || "").trim();
  var body = String(payload.body || "");
  if (!messageId) return { error: "message_not_found" };
  if (!from) return { error: "invalid_from" };

  var allowed = listSendAsAddresses_();
  var fromLower = from.toLowerCase();
  var allowedHit = false;
  for (var i = 0; i < allowed.aliases.length; i++) {
    if (String(allowed.aliases[i]).toLowerCase() === fromLower) {
      allowedHit = true;
      from = String(allowed.aliases[i]);
      break;
    }
  }
  if (!allowedHit) {
    return { error: "invalid_from" };
  }

  var message;
  try {
    message = GmailApp.getMessageById(messageId);
  } catch (e) {
    return { error: "message_not_found" };
  }
  if (!message) return { error: "message_not_found" };

  var options = {};
  // primary 以外は from 指定。primary も明示してよい
  options.from = from;
  // 送信は絶対にしない
  message.createDraftReply(body, options);
  return { status: "draft_created" };
}

/**
 * Web App endpoint（SalesSystem server からのみ呼ぶ想定）。
 * 本文・secret・signature はログしない。
 */
function doPost(e) {
  try {
    var props = getProps_();
    if (!props.draftSecret || props.draftSecret.length < 16) {
      return jsonResponse_({ error: "not_configured" });
    }
    var envelope = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var verified = verifyDraftEnvelope_(envelope, props.draftSecret);
    if (!verified.ok) {
      return jsonResponse_({ error: "unauthorized", reason: verified.reason });
    }
    var payload = decodePayloadB64_(envelope.payload_b64);
    var action = String(payload.action || "");
    if (action === "list_aliases") {
      var addrs = listSendAsAddresses_();
      return jsonResponse_({
        status: "ok",
        primary: addrs.primary,
        aliases: addrs.aliases,
      });
    }
    if (action === "create_reply_draft") {
      var created = createReplyDraft_(payload);
      if (created.error) return jsonResponse_(created);
      return jsonResponse_(created);
    }
    return jsonResponse_({ error: "unknown_action" });
  } catch (err) {
    return jsonResponse_({ error: "draft_failed" });
  }
}

function doGet() {
  return jsonResponse_({ error: "method_not_allowed" });
}
