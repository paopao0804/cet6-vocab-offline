window.CET6_OFFLINE = true;

const DB_NAME = "cet6-offline";
const DB_VERSION = 1;
const STORE_PROGRESS = "progress";
const STORE_LOGS = "logs";
const STORE_CUSTOM_WORDS = "custom_words";
const STORE_META = "meta";
const seedWords = Array.isArray(window.CET6_WORDS) ? window.CET6_WORDS : [];
const nativeFetch = window.fetch.bind(window);

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_PROGRESS)) {
        database.createObjectStore(STORE_PROGRESS, { keyPath: "wordId" });
      }
      if (!database.objectStoreNames.contains(STORE_LOGS)) {
        const logs = database.createObjectStore(STORE_LOGS, {
          keyPath: "id",
          autoIncrement: true,
        });
        logs.createIndex("date", "date", { unique: false });
      }
      if (!database.objectStoreNames.contains(STORE_CUSTOM_WORDS)) {
        database.createObjectStore(STORE_CUSTOM_WORDS, { keyPath: "word" });
      }
      if (!database.objectStoreNames.contains(STORE_META)) {
        database.createObjectStore(STORE_META, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return databasePromise;
}

async function withStore(storeName, mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  return withStore(storeName, "readonly", (store) => store.getAll());
}

async function getOne(storeName, key) {
  return withStore(storeName, "readonly", (store) => store.get(key));
}

async function putOne(storeName, value) {
  return withStore(storeName, "readwrite", (store) => store.put(value));
}

async function clearStore(storeName) {
  return withStore(storeName, "readwrite", (store) => store.clear());
}

async function getSetting(key, fallback) {
  const row = await getOne(STORE_META, key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await putOne(STORE_META, { key, value });
}

async function getDailyGoal() {
  const value = Number(await getSetting("daily_goal", 30));
  return Math.max(5, Math.min(200, value || 30));
}

async function getAllWords() {
  const custom = await getAll(STORE_CUSTOM_WORDS);
  return [
    ...seedWords.map((word, index) => ({
      ...word,
      id: index + 1,
      custom: false,
    })),
    ...custom.map((word) => ({
      ...word,
      id: customWordId(word.word),
      custom: true,
    })),
  ];
}

function customWordId(word) {
  let hash = 2166136261;
  for (const char of String(word).toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 2_000_000 + (hash >>> 0) % 1_000_000;
}

window.fetch = async (input, init = {}) => {
  const rawUrl = typeof input === "string" ? input : input.url;
  const url = new URL(rawUrl, window.location.href);
  if (!url.pathname.includes("/api/")) {
    return nativeFetch(input, init);
  }

  try {
    return await handleApi(url, init);
  } catch (error) {
    return jsonResponse({ error: error.message || "离线数据操作失败。" }, 500);
  }
};

async function handleApi(url, init) {
  const method = String(init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(String(init.body)) : {};

  if (method === "GET" && url.pathname.endsWith("/api/auth/state")) {
    return jsonResponse({
      setupRequired: false,
      registrationEnabled: false,
      authenticated: true,
      user: await localUser(),
    });
  }

  if (method === "GET" && url.pathname.endsWith("/api/dashboard")) {
    return jsonResponse(await dashboard());
  }

  if (method === "GET" && url.pathname.endsWith("/api/study")) {
    const limit = Math.max(
      5,
      Math.min(60, Number.parseInt(url.searchParams.get("limit") || "30", 10) || 30),
    );
    return jsonResponse(await studyQueue(limit));
  }

  if (method === "POST" && url.pathname.endsWith("/api/reviews")) {
    return jsonResponse(await recordReview(body));
  }

  if (method === "GET" && url.pathname.endsWith("/api/records")) {
    const days = Math.max(
      28,
      Math.min(365, Number.parseInt(url.searchParams.get("days") || "84", 10) || 84),
    );
    return jsonResponse(await records(days));
  }

  if (method === "GET" && url.pathname.endsWith("/api/words")) {
    return jsonResponse(
      await wordList({
        query: url.searchParams.get("q") || "",
        filter: url.searchParams.get("filter") || "all",
        limit: Number.parseInt(url.searchParams.get("limit") || "160", 10) || 160,
      }),
    );
  }

  if (method === "GET" && url.pathname.endsWith("/api/dictionary")) {
    return jsonResponse(
      await dictionaryLookup(url.searchParams.get("word") || ""),
    );
  }

  if (method === "POST" && url.pathname.endsWith("/api/words/import")) {
    return jsonResponse(await importWords(body.csv));
  }

  if (method === "PATCH" && url.pathname.endsWith("/api/settings")) {
    const dailyGoal = Math.max(
      5,
      Math.min(200, Number.parseInt(body.dailyGoal || "30", 10) || 30),
    );
    await setSetting("daily_goal", dailyGoal);
    return jsonResponse({
      user: await localUser(),
      dashboard: await dashboard(),
    });
  }

  if (method === "POST" && url.pathname.endsWith("/api/auth/logout")) {
    return jsonResponse({ authenticated: false });
  }

  return jsonResponse({ error: "离线版不支持这个接口。" }, 404);
}

async function localUser() {
  return {
    id: 1,
    username: "offline",
    displayName: "本机学习者",
    dailyGoal: await getDailyGoal(),
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };
}

async function dashboard() {
  const [progress, logs, words, dailyGoal, goal] = await Promise.all([
    getAll(STORE_PROGRESS),
    getAll(STORE_LOGS),
    getAllWords(),
    getDailyGoal(),
    getDailyGoal(),
  ]);
  const today = localDate();
  const now = Date.now();
  const todayLogs = logs.filter((log) => log.date === today);
  const learnedIds = new Set(todayLogs.filter((log) => log.isNew).map((log) => log.wordId));
  const studiedIds = new Set(todayLogs.map((log) => log.wordId));
  const dueProgress = progress.filter(
    (item) => new Date(item.nextReviewAt).getTime() <= now,
  );
  const newToday = learnedIds.size;
  const dailyGoalValue = goal || dailyGoal;

  return {
    today,
    dailyGoal: dailyGoalValue,
    todayStudied: studiedIds.size,
    newToday,
    newRemaining: Math.max(0, dailyGoalValue - newToday),
    reviewAnswersToday: todayLogs.filter((log) => !log.isNew).length,
    knownAnswersToday: todayLogs.filter((log) => log.result === "known").length,
    due: dueProgress.length,
    reinforcementDue: dueProgress.filter((item) => item.reinforcementLevel > 0).length,
    secondDayDue: dueProgress.filter((item) => item.reviewCount === 1).length,
    totalWords: words.length,
    learned: progress.length,
    learning: progress.filter((item) => item.stage < 2).length,
    familiar: progress.filter((item) => item.stage >= 2 && item.stage < 5).length,
    mastered: progress.filter((item) => item.stage >= 5).length,
    streak: calculateStreak(logs),
    progressPercent:
      dailyGoalValue > 0
        ? Math.min(100, Math.round((newToday / dailyGoalValue) * 100))
        : 0,
  };
}

async function studyQueue(limit) {
  const [dashboardData, progress, words] = await Promise.all([
    dashboard(),
    getAll(STORE_PROGRESS),
    getAllWords(),
  ]);
  const now = Date.now();
  const wordMap = new Map(words.map((word) => [word.id, word]));
  const due = progress
    .filter((item) => new Date(item.nextReviewAt).getTime() <= now)
    .sort((a, b) => new Date(a.nextReviewAt) - new Date(b.nextReviewAt))
    .slice(0, limit);
  const progressIds = new Set(progress.map((item) => item.wordId));
  const newWords = shuffle(words.filter((word) => !progressIds.has(word.id))).slice(
    0,
    Math.max(0, dashboardData.newRemaining),
  );
  const reinforcedDue = reinforceQueue(due, limit);
  const remainingSlots = Math.max(0, limit - reinforcedDue.length);
  const selectedNew = newWords.slice(0, remainingSlots);

  const items = shuffle([
    ...reinforcedDue.map((progressItem) =>
      serializeStudyWord(progressItem, wordMap.get(progressItem.wordId)),
    ),
    ...selectedNew.map((word) =>
      serializeStudyWord(
        {
          wordId: word.id,
          stage: 0,
          nextReviewAt: null,
          reviewCount: 0,
          knownCount: 0,
          reinforcementLevel: 0,
        },
        word,
        "new",
      ),
    ),
  ]);

  return { dashboard: await dashboard(), items };
}

function reinforceQueue(due, limit) {
  const base = due.map((item) => ({
    ...item,
    reinforcement: item.reinforcementLevel > 0,
    reinforcementCopy: 0,
  }));
  const extras = [];
  for (let copy = 1; copy <= 2; copy += 1) {
    for (const item of base) {
      if (item.reinforcementLevel >= copy) {
        extras.push({ ...item, reinforcementCopy: copy });
      }
    }
  }
  const result = [];
  while ((base.length || extras.length) && result.length < limit) {
    if (base.length) result.push(base.shift());
    if (extras.length && result.length < limit) result.push(extras.shift());
  }
  return result;
}

function serializeStudyWord(progressItem, word, itemType) {
  if (!word) return null;
  return {
    ...word,
    itemType:
      itemType ||
      (progressItem.reviewCount === 1 ? "second_day" : "review"),
    stage: progressItem.stage || 0,
    nextReviewAt: progressItem.nextReviewAt || null,
    reviewCount: progressItem.reviewCount || 0,
    knownCount: progressItem.knownCount || 0,
    reinforcementLevel: progressItem.reinforcementLevel || 0,
    reinforcement: Boolean(progressItem.reinforcement),
    reinforcementCopy: progressItem.reinforcementCopy || 0,
  };
}

async function recordReview(body) {
  const wordId = Number.parseInt(body.wordId, 10);
  const result = String(body.result || "");
  if (!Number.isInteger(wordId) || !["unknown", "fuzzy", "known"].includes(result)) {
    throw new Error("无效的复习记录。");
  }

  const words = await getAllWords();
  const word = words.find((item) => item.id === wordId);
  if (!word) throw new Error("没有找到这个单词。");

  const current = await getOne(STORE_PROGRESS, wordId);
  const now = new Date();
  const schedule = nextSchedule({
    result,
    stage: current?.stage || 0,
    isNew: !current,
    now,
  });
  const reinforcementLevel =
    result === "unknown" ? 2 : result === "fuzzy" ? 1 : 0;
  const isNew = !current;
  const progressItem = {
    wordId,
    stage: schedule.stage,
    nextReviewAt: schedule.nextReviewAt,
    firstSeenAt: current?.firstSeenAt || now.toISOString(),
    lastReviewedAt: now.toISOString(),
    reviewCount: (current?.reviewCount || 0) + 1,
    knownCount: (current?.knownCount || 0) + (result === "known" ? 1 : 0),
    reinforcementLevel,
    lastResult: result,
  };
  await putOne(STORE_PROGRESS, progressItem);
  await withStore(STORE_LOGS, "readwrite", (store) =>
    store.add({
      wordId,
      result,
      stageBefore: current?.stage || 0,
      stageAfter: schedule.stage,
      intervalDays: schedule.intervalDays,
      nextReviewAt: schedule.nextReviewAt,
      isNew,
      date: localDate(now),
      createdAt: now.toISOString(),
    }),
  );

  return {
    wordId,
    result,
    isNew,
    stage: schedule.stage,
    mastery: masteryLevel(schedule.stage),
    intervalDays: schedule.intervalDays,
    reinforcementLevel,
    nextReviewAt: schedule.nextReviewAt,
    dashboard: await dashboard(),
  };
}

async function records(days) {
  const [logs, words] = await Promise.all([getAll(STORE_LOGS), getAllWords()]);
  const wordMap = new Map(words.map((word) => [word.id, word]));
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const startDate = localDate(start);
  const todayDate = localDate(today);
  const grouped = new Map();

  for (const log of logs) {
    if (log.date < startDate || log.date > todayDate) continue;
    const row = grouped.get(log.date) || {
      date: log.date,
      studiedIds: new Set(),
      newIds: new Set(),
      reviews: 0,
      known: 0,
      fuzzy: 0,
      unknown: 0,
    };
    row.studiedIds.add(log.wordId);
    if (log.isNew) row.newIds.add(log.wordId);
    if (!log.isNew) row.reviews += 1;
    row[log.result] += 1;
    grouped.set(log.date, row);
  }

  const recent = [...logs]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 24)
    .map((log) => ({
      ...log,
      word: wordMap.get(log.wordId)?.word || "",
      meaning: wordMap.get(log.wordId)?.meaning || "",
    }));

  return {
    days,
    startDate,
    today: todayDate,
    daily: [...grouped.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        date: row.date,
        studied: row.studiedIds.size,
        newWords: row.newIds.size,
        reviews: row.reviews,
        known: row.known,
        fuzzy: row.fuzzy,
        unknown: row.unknown,
      })),
    recent,
  };
}

async function wordList({ query, filter, limit }) {
  const [words, progress] = await Promise.all([
    getAllWords(),
    getAll(STORE_PROGRESS),
  ]);
  const progressMap = new Map(progress.map((item) => [item.wordId, item]));
  const normalizedQuery = query.trim().toLowerCase();
  const now = Date.now();
  const items = words
    .map((word) => {
      const item = progressMap.get(word.id);
      return {
        ...word,
        isNew: !item,
        stage: item?.stage ?? null,
        mastery: item ? masteryLevel(item.stage) : "new",
        nextReviewAt: item?.nextReviewAt || null,
        reviewCount: item?.reviewCount || 0,
        knownCount: item?.knownCount || 0,
        reinforcementLevel: item?.reinforcementLevel || 0,
        lastResult: item?.lastResult || null,
      };
    })
    .filter((item) => {
      if (
        normalizedQuery &&
        !item.word.toLowerCase().includes(normalizedQuery) &&
        !item.meaning.toLowerCase().includes(normalizedQuery)
      ) {
        return false;
      }
      if (filter === "new") return item.isNew;
      if (filter === "due") {
        return item.nextReviewAt && new Date(item.nextReviewAt).getTime() <= now;
      }
      if (filter === "learning") return !item.isNew && item.stage < 2;
      if (filter === "familiar") return !item.isNew && item.stage >= 2 && item.stage < 5;
      if (filter === "mastered") return !item.isNew && item.stage >= 5;
      return true;
    })
    .sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
      return a.word.localeCompare(b.word);
    })
    .slice(0, Math.max(1, Math.min(250, limit)));
  return { items };
}

async function dictionaryLookup(rawWord) {
  const query = String(rawWord || "").trim().toLowerCase();
  if (!/^[a-z][a-z' -]{0,63}$/.test(query)) {
    throw new Error("请输入一个英文单词。");
  }
  const words = await getAllWords();
  const local = words.find((word) => word.word.toLowerCase() === query);
  const suggestions = local
    ? []
    : words
        .filter((word) => word.word.toLowerCase().startsWith(query))
        .slice(0, 8)
        .map((word) => word.word);
  return {
    query,
    local: local
      ? {
          ...local,
          isNew: !(await getOne(STORE_PROGRESS, local.id)),
          mastery: "new",
          reviewCount: 0,
          knownCount: 0,
          reinforcementLevel: 0,
        }
      : null,
    remote: null,
    remoteStatus: "offline",
    suggestions,
  };
}

async function importWords(csv) {
  const rows = parseCsv(String(csv || "").replace(/^\uFEFF/, "").trim());
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一行单词。");
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const wordIndex = headers.findIndex((value) => ["word", "单词"].includes(value));
  const meaningIndex = headers.findIndex((value) =>
    ["meaning", "definition", "释义", "中文"].includes(value),
  );
  if (wordIndex < 0 || meaningIndex < 0) {
    throw new Error("CSV 表头至少需要 word 和 meaning 两列。");
  }

  const indexOf = (...names) =>
    headers.findIndex((header) => names.includes(header));
  const phoneticIndex = indexOf("phonetic", "音标");
  const posIndex = indexOf("part_of_speech", "partofspeech", "pos", "词性");
  const exampleIndex = indexOf("example", "例句");
  const translationIndex = indexOf(
    "example_translation",
    "exampletranslation",
    "例句翻译",
  );
  let inserted = 0;
  const existing = new Set((await getAll(STORE_CUSTOM_WORDS)).map((word) => word.word.toLowerCase()));

  for (const row of rows.slice(1)) {
    const word = String(row[wordIndex] || "").trim();
    const meaning = String(row[meaningIndex] || "").trim();
    if (!word || !meaning || existing.has(word.toLowerCase())) continue;
    await putOne(STORE_CUSTOM_WORDS, {
      word,
      phonetic: phoneticIndex >= 0 ? String(row[phoneticIndex] || "").trim() : "",
      partOfSpeech: posIndex >= 0 ? String(row[posIndex] || "").trim() : "",
      meaning,
      example: exampleIndex >= 0 ? String(row[exampleIndex] || "").trim() : "",
      exampleTranslation:
        translationIndex >= 0 ? String(row[translationIndex] || "").trim() : "",
      addedAt: new Date().toISOString(),
    });
    existing.add(word.toLowerCase());
    inserted += 1;
  }
  return { inserted };
}

function nextSchedule({ result, stage = 0, isNew = false, now = new Date() }) {
  const intervals = [1, 3, 7, 14, 30, 60, 120];
  const maxStage = intervals.length - 1;
  let nextStage = 0;
  let intervalDays = 1;

  if (isNew) {
    nextStage = result === "known" ? 1 : 0;
    intervalDays = 1;
  } else if (result === "known") {
    nextStage = Math.min(maxStage, Math.max(0, stage) + 1);
    intervalDays = intervals[nextStage];
  } else if (result === "fuzzy") {
    nextStage = Math.max(0, Math.min(maxStage, stage) - 1);
    intervalDays = Math.max(1, Math.round(intervals[nextStage] / 2));
  }

  return {
    stage: nextStage,
    intervalDays,
    nextReviewAt: new Date(
      now.getTime() + intervalDays * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
}

function masteryLevel(stage) {
  if (stage >= 5) return "mastered";
  if (stage >= 2) return "familiar";
  return "learning";
}

function calculateStreak(logs) {
  const dates = new Set(logs.map((log) => log.date));
  if (!dates.size) return 0;
  const cursor = new Date();
  if (!dates.has(localDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dates.has(localDate(cursor))) return 0;
  }
  let streak = 0;
  while (dates.has(localDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function localDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

async function exportData() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    progress: await getAll(STORE_PROGRESS),
    logs: await getAll(STORE_LOGS),
    customWords: await getAll(STORE_CUSTOM_WORDS),
    meta: await getAll(STORE_META),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `cet6-offline-backup-${localDate()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function importData(file) {
  const payload = JSON.parse(await file.text());
  if (!payload || !Array.isArray(payload.progress) || !Array.isArray(payload.logs)) {
    throw new Error("备份文件格式不正确。");
  }
  for (const store of [
    STORE_PROGRESS,
    STORE_LOGS,
    STORE_CUSTOM_WORDS,
    STORE_META,
  ]) {
    await clearStore(store);
  }
  for (const item of payload.progress) await putOne(STORE_PROGRESS, item);
  for (const item of payload.logs) {
    const { id, ...log } = item;
    await withStore(STORE_LOGS, "readwrite", (store) => store.add(log));
  }
  for (const item of payload.customWords || []) {
    await putOne(STORE_CUSTOM_WORDS, item);
  }
  for (const item of payload.meta || []) await putOne(STORE_META, item);
}

async function resetData() {
  for (const store of [
    STORE_PROGRESS,
    STORE_LOGS,
    STORE_CUSTOM_WORDS,
    STORE_META,
  ]) {
    await clearStore(store);
  }
}

window.CET6Offline = {
  exportData,
  importData,
  resetData,
};

if ("serviceWorker" in navigator && /^https?:$/.test(window.location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
