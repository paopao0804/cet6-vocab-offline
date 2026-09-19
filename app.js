const root = document.querySelector("#root");
const offlineMode = Boolean(window.CET6_OFFLINE);

const state = {
  ready: false,
  fatalError: "",
  authenticated: false,
  setupRequired: false,
  registrationEnabled: false,
  authMode: "login",
  user: null,
  dashboard: null,
  view: "today",
  records: null,
  recordsLoading: false,
  words: null,
  wordsLoading: false,
  wordFilter: "all",
  wordQuery: "",
  expandedWord: null,
  lookupQuery: "",
  lookupResult: null,
  lookupLoading: false,
  lookupError: "",
  lookupRecent: readStoredLookups(),
  invites: null,
  invitesLoading: false,
  queue: [],
  studyIndex: 0,
  revealed: false,
  savingReview: false,
  studyLoading: false,
  studyComplete: false,
  sessionResults: [],
  modal: null,
  toast: null,
  toastTimer: null,
  focusId: null,
};

const navItems = [
  { id: "today", label: "今日", icon: "home" },
  { id: "lookup", label: "查词", icon: "search" },
  { id: "records", label: "记录", icon: "calendar" },
  { id: "words", label: "词库", icon: "book" },
  { id: "settings", label: "设置", icon: "settings" },
];

const filterItems = [
  { id: "all", label: "全部" },
  { id: "new", label: "未学习" },
  { id: "due", label: "待复习" },
  { id: "learning", label: "学习中" },
  { id: "familiar", label: "熟悉" },
  { id: "mastered", label: "掌握" },
];

const resultLabels = {
  known: "认识",
  fuzzy: "模糊",
  unknown: "不认识",
};

const masteryLabels = {
  new: "未学习",
  learning: "学习中",
  familiar: "熟悉",
  mastered: "掌握",
};

root.addEventListener("click", async (event) => {
  const navButton = event.target.closest("[data-view]");
  if (navButton) {
    await navigate(navButton.dataset.view);
    return;
  }

  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    if (
      state.modal &&
      event.target.matches("[data-modal-backdrop]")
    ) {
      state.modal = null;
      render();
    }
    return;
  }

  event.preventDefault();
  const action = actionTarget.dataset.action;

  if (action === "start-study") {
    await startStudy();
  } else if (action === "auth-mode") {
    state.authMode = actionTarget.dataset.mode || "login";
    render();
  } else if (action === "retry-bootstrap") {
    state.fatalError = "";
    state.ready = false;
    render();
    await bootstrap();
  } else if (action === "show-answer") {
    state.revealed = true;
    render();
  } else if (action === "shuffle-queue") {
    reshuffleStudyQueue();
  } else if (action === "lookup-suggestion") {
    state.lookupQuery = actionTarget.dataset.word || "";
    await lookupWord(state.lookupQuery);
  } else if (action === "review") {
    await submitReview(actionTarget.dataset.result);
  } else if (action === "exit-study") {
    state.view = "today";
    state.studyComplete = false;
    await loadDashboard();
    render();
  } else if (action === "study-again") {
    await startStudy();
  } else if (action === "speak") {
    speakWord(actionTarget.dataset.word);
  } else if (action === "play-audio") {
    playAudio(actionTarget.dataset.url);
  } else if (action === "toggle-word") {
    const wordId = Number(actionTarget.dataset.id);
    state.expandedWord = state.expandedWord === wordId ? null : wordId;
    render();
  } else if (action === "set-filter") {
    const filter = actionTarget.dataset.filter;
    if (filter !== state.wordFilter) {
      state.wordFilter = filter;
      state.words = null;
      await loadWords();
      render();
    }
  } else if (action === "open-import") {
    state.modal = "import";
    render();
  } else if (action === "copy-invite") {
    await copyInviteCode(actionTarget.dataset.code || "");
  } else if (action === "revoke-invite") {
    await revokeInvite(Number(actionTarget.dataset.id));
  } else if (action === "export-offline-data") {
    await exportOfflineData();
  } else if (action === "import-offline-data") {
    root.querySelector("#offline-import-file")?.click();
  } else if (action === "reset-offline-data") {
    await resetOfflineData();
  } else if (action === "close-modal") {
    state.modal = null;
    render();
  } else if (action === "logout") {
    await logout();
  } else if (action === "goal-step") {
    const input = root.querySelector("#daily-goal");
    if (!input) return;
    const step = Number(actionTarget.dataset.step || 0);
    input.value = String(clamp(Number(input.value || 0) + step, 5, 200));
  }
});

root.addEventListener("input", (event) => {
  const input = event.target.closest('[data-action="word-search"]');
  if (!input) return;
  state.wordQuery = input.value;
  state.focusId = "word-search";
  clearTimeout(input._searchTimer);
  input._searchTimer = setTimeout(async () => {
    state.words = null;
    state.wordsLoading = true;
    render();
    await loadWords();
    render();
  }, 260);
});

root.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();

  if (form.dataset.form === "auth") {
    await submitAuth(form);
  } else if (form.dataset.form === "invite") {
    await submitInvite(form);
  } else if (form.dataset.form === "lookup") {
    const formData = new FormData(form);
    await lookupWord(String(formData.get("word") || ""));
  } else if (form.dataset.form === "settings") {
    await submitSettings(form);
  } else if (form.dataset.form === "import") {
    await submitImport(form);
  }
});

root.addEventListener("change", async (event) => {
  const input = event.target.closest("#offline-import-file");
  if (!input || !input.files?.[0]) return;
  await importOfflineData(input.files[0]);
});

document.addEventListener("keydown", async (event) => {
  if (state.view !== "study" || state.modal || state.studyComplete) return;
  if (event.target.matches("input, textarea")) return;

  if (!state.revealed && (event.code === "Space" || event.code === "Enter")) {
    event.preventDefault();
    state.revealed = true;
    render();
  } else if (state.revealed && ["Digit1", "Digit2", "Digit3"].includes(event.code)) {
    event.preventDefault();
    const result = {
      Digit1: "unknown",
      Digit2: "fuzzy",
      Digit3: "known",
    }[event.code];
    await submitReview(result);
  } else if (event.code === "Escape") {
    state.view = "today";
    await loadDashboard();
    render();
  }
});

async function api(path, options = {}) {
  const requestOptions = {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  };

  let response;
  try {
    response = await fetch(path, requestOptions);
  } catch {
    throw new Error("无法连接服务器，请检查网络后重试。");
  }

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith("/api/auth/login") &&
      !path.startsWith("/api/auth/setup")
    ) {
      state.authenticated = false;
      state.user = null;
    }
    throw new Error(payload.error || "请求失败，请稍后重试。");
  }

  return payload;
}

async function bootstrap() {
  try {
    const auth = await api("/api/auth/state");
    state.authenticated = Boolean(auth.authenticated);
    state.setupRequired = Boolean(auth.setupRequired);
    state.registrationEnabled = Boolean(auth.registrationEnabled);
    state.authMode = state.setupRequired ? "setup" : "login";
    state.user = auth.user;
    state.ready = true;

    if (state.authenticated) {
      await loadDashboard();
    }
    render();
  } catch (error) {
    state.ready = true;
    state.fatalError = error.message;
    render();
  }
}

async function submitAuth(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const errorElement = form.querySelector(".form-error");
  const formData = new FormData(form);
  const mode = form.dataset.mode;
  const isSetup = mode === "setup";
  const isRegister = mode === "register";
  const payload = isSetup
    ? {
        displayName: formData.get("displayName"),
        username: formData.get("username"),
        password: formData.get("password"),
        dailyGoal: 30,
      }
    : isRegister
      ? {
          inviteCode: formData.get("inviteCode"),
          displayName: formData.get("displayName"),
          username: formData.get("username"),
          password: formData.get("password"),
          dailyGoal: 30,
        }
    : {
        username: formData.get("username"),
        password: formData.get("password"),
      };

  submitButton.disabled = true;
  errorElement.textContent = "";

  try {
    const endpoint = isSetup
      ? "/api/auth/setup"
      : isRegister
        ? "/api/auth/register"
        : "/api/auth/login";
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.authenticated = true;
    state.setupRequired = false;
    state.registrationEnabled = true;
    state.authMode = "login";
    state.user = result.user;
    state.view = "today";
    await loadDashboard();
    render();
  } catch (error) {
    errorElement.textContent = error.message;
    submitButton.disabled = false;
  }
}

async function submitSettings(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  submitButton.disabled = true;

  try {
    const result = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: formData.get("displayName"),
        dailyGoal: formData.get("dailyGoal"),
      }),
    });
    state.user = result.user;
    state.dashboard = result.dashboard;
    showToast("设置已保存。");
  } catch (error) {
    showToast(error.message, "error");
    submitButton.disabled = false;
  }
}

async function submitInvite(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const formData = new FormData(form);
  submitButton.disabled = true;

  try {
    const result = await api("/api/invites", {
      method: "POST",
      body: JSON.stringify({
        label: formData.get("label"),
        maxUses: formData.get("maxUses"),
        expiresInDays: formData.get("expiresInDays"),
      }),
    });
    state.invites = [result.invite, ...(state.invites || [])];
    form.reset();
    showToast(`邀请码 ${result.invite.code} 已生成。`);
  } catch (error) {
    showToast(error.message, "error");
    submitButton.disabled = false;
  }
}

async function loadInvites() {
  if (!state.user?.isAdmin) {
    state.invites = [];
    return;
  }
  state.invitesLoading = true;
  render();
  try {
    const result = await api("/api/invites");
    state.invites = result.items;
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.invitesLoading = false;
    render();
  }
}

async function copyInviteCode(code) {
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast("邀请码已复制。");
  } catch {
    showToast("复制失败，请手动选择邀请码。", "error");
  }
}

async function revokeInvite(inviteId) {
  if (!Number.isInteger(inviteId)) return;
  if (!window.confirm("确定要撤销这个邀请码吗？")) return;

  try {
    await api(`/api/invites/${inviteId}`, { method: "DELETE" });
    state.invites = (state.invites || []).map((invite) =>
      invite.id === inviteId
        ? { ...invite, revokedAt: new Date().toISOString(), active: false }
        : invite,
    );
    showToast("邀请码已撤销。");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function exportOfflineData() {
  if (!window.CET6Offline?.exportData) return;
  try {
    await window.CET6Offline.exportData();
    showToast("离线备份已导出。");
  } catch (error) {
    showToast(error.message || "导出失败。", "error");
  }
}

async function importOfflineData(file) {
  if (!window.CET6Offline?.importData) return;
  try {
    await window.CET6Offline.importData(file);
    showToast("备份已导入，正在刷新。");
    setTimeout(() => window.location.reload(), 700);
  } catch (error) {
    showToast(error.message || "导入失败。", "error");
  }
}

async function resetOfflineData() {
  if (!window.CET6Offline?.resetData) return;
  if (!window.confirm("确定要清空本机所有学习记录吗？")) return;
  await window.CET6Offline.resetData();
  window.location.reload();
}

async function submitImport(form) {
  const submitButton = form.querySelector('button[type="submit"]');
  const fileInput = form.querySelector('input[type="file"]');
  const textArea = form.querySelector("textarea");
  let csv = String(textArea?.value || "").trim();

  if (fileInput?.files?.[0]) {
    csv = await fileInput.files[0].text();
  }

  if (!csv) {
    showToast("请选择 CSV 文件或粘贴词表内容。", "error");
    return;
  }

  submitButton.disabled = true;
  try {
    const result = await api("/api/words/import", {
      method: "POST",
      body: JSON.stringify({ csv }),
    });
    state.modal = null;
    state.words = null;
    await loadWords();
    showToast(`已导入 ${result.inserted} 个新单词。`);
  } catch (error) {
    showToast(error.message, "error");
    submitButton.disabled = false;
  }
}

async function lookupWord(rawWord) {
  const word = String(rawWord || "").trim().toLowerCase();
  if (!word) return;

  state.lookupQuery = word;
  state.lookupLoading = true;
  state.lookupError = "";
  state.lookupResult = null;
  state.view = "lookup";
  render();

  try {
    const result = await api(`/api/dictionary?word=${encodeURIComponent(word)}`);
    state.lookupResult = result;
    rememberLookup(result.local?.word || result.query || word);
  } catch (error) {
    state.lookupError = error.message;
  } finally {
    state.lookupLoading = false;
    render();
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    state.authenticated = false;
    state.user = null;
    state.dashboard = null;
    state.records = null;
    state.words = null;
    state.view = "today";
    state.authMode = "login";
    render();
  }
}

async function navigate(view) {
  state.view = view;
  state.modal = null;
  state.expandedWord = null;

  if (view === "records" && !state.records) {
    state.recordsLoading = true;
    render();
    await loadRecords();
  } else if (view === "words" && !state.words) {
    state.wordsLoading = true;
    render();
    await loadWords();
  } else if (view === "settings" && state.user?.isAdmin && !state.invites) {
    await loadInvites();
  } else {
    render();
  }
}

async function loadDashboard() {
  try {
    state.dashboard = await api("/api/dashboard");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadRecords() {
  state.recordsLoading = true;
  render();
  try {
    state.records = await api("/api/records?days=84");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.recordsLoading = false;
    render();
  }
}

async function loadWords() {
  state.wordsLoading = true;
  const params = new URLSearchParams({
    q: state.wordQuery,
    filter: state.wordFilter,
    limit: "160",
  });

  try {
    state.words = await api(`/api/words?${params.toString()}`);
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.wordsLoading = false;
    render();
  }
}

async function startStudy() {
  state.studyLoading = true;
  state.studyComplete = false;
  state.sessionResults = [];
  state.queue = [];
  state.studyIndex = 0;
  state.revealed = false;
  state.view = "study";
  render();

  try {
    const result = await api("/api/study?limit=30");
    state.dashboard = result.dashboard;
    state.queue = result.items;
    state.studyComplete = result.items.length === 0;
  } catch (error) {
    showToast(error.message, "error");
    state.view = "today";
  } finally {
    state.studyLoading = false;
    render();
  }
}

async function submitReview(result) {
  if (state.savingReview || state.studyComplete) return;
  const item = state.queue[state.studyIndex];
  if (!item) return;

  state.savingReview = true;
  render();

  try {
    const payload = await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        wordId: item.id,
        result,
      }),
    });
    state.dashboard = payload.dashboard;
    state.sessionResults.push({
      result,
      word: item.word,
      isNew: payload.isNew,
    });
    state.studyIndex += 1;
    state.revealed = false;
    state.studyComplete = state.studyIndex >= state.queue.length;
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.savingReview = false;
    render();
  }
}

function reshuffleStudyQueue() {
  if (
    state.view !== "study" ||
    state.studyComplete ||
    state.savingReview ||
    state.queue.length < 2
  ) {
    return;
  }

  const current = state.queue[state.studyIndex];
  const remaining = state.queue.slice(state.studyIndex + 1);
  if (remaining.length < 2) {
    showToast("剩余单词不足，无法重新打乱。");
    return;
  }

  state.queue = [
    ...state.queue.slice(0, state.studyIndex),
    current,
    ...shuffleArray(remaining),
  ];
  state.revealed = false;
  render();
}

function speakWord(word) {
  if (!word || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  utterance.rate = 0.88;
  window.speechSynthesis.speak(utterance);
}

function playAudio(url) {
  if (!url) return;
  const audio = new Audio(url);
  audio.play().catch(() => {});
}

function readStoredLookups() {
  try {
    const stored = JSON.parse(localStorage.getItem("cet6_recent_lookups") || "[]");
    return Array.isArray(stored) ? stored.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberLookup(word) {
  const normalized = String(word || "").trim().toLowerCase();
  if (!normalized) return;
  state.lookupRecent = [
    normalized,
    ...state.lookupRecent.filter((item) => item !== normalized),
  ].slice(0, 8);
  try {
    localStorage.setItem("cet6_recent_lookups", JSON.stringify(state.lookupRecent));
  } catch {
    // Storage can be unavailable in private browsing modes.
  }
}

function showToast(message, type = "info") {
  const toastId = Date.now();
  state.toast = { id: toastId, message, type };
  clearTimeout(state.toastTimer);
  render();
  state.toastTimer = setTimeout(() => {
    if (state.toast?.id === toastId) {
      state.toast = null;
      render();
    }
  }, 2800);
}

function render() {
  if (!state.ready) return;

  if (state.fatalError) {
    root.innerHTML = renderFatal(state.fatalError);
    return;
  }

  if (!state.authenticated) {
    root.innerHTML = renderAuth();
    restoreFocus();
    return;
  }

  if (!state.dashboard) {
    root.innerHTML = `
      <div class="boot-screen">
        <div class="brand-mark">${icon("book")}</div>
        <div class="spinner"></div>
      </div>
    `;
    return;
  }

  const isStudy = state.view === "study";
  const page = renderCurrentView();
  root.innerHTML = `
    <div class="app-shell${isStudy ? " is-study" : ""}">
      ${isStudy ? "" : renderSidebar()}
      <div class="app-main">
        ${isStudy ? "" : renderMobileHeader()}
        <main class="content">${page}</main>
        ${isStudy ? "" : renderBottomNav()}
      </div>
      ${state.modal ? renderModal() : ""}
      ${state.toast ? `<div class="toast${state.toast.type === "error" ? " is-error" : ""}" role="status">${escapeHtml(state.toast.message)}</div>` : ""}
    </div>
  `;
  restoreFocus();
}

function renderFatal(message) {
  return `
    <div class="auth-shell">
      <section class="auth-card">
        <div class="brand-mark">${icon("book")}</div>
        <h1 class="auth-title" style="margin-top: 20px;">无法打开</h1>
        <p class="auth-subtitle">${escapeHtml(message)}</p>
        <button class="btn btn-primary btn-block" data-action="retry-bootstrap">重试</button>
      </section>
    </div>
  `;
}

function renderAuth() {
  const mode = state.setupRequired ? "setup" : state.authMode;
  const isSetup = mode === "setup";
  const isRegister = mode === "register";
  const title = isSetup ? "创建账号" : isRegister ? "邀请码注册" : "登录";
  const subtitle = isSetup
    ? "创建后，手机和电脑使用同一个账号。"
    : isRegister
      ? "输入管理员提供的邀请码创建新账号。"
      : "继续你的学习记录。";
  return `
    <div class="auth-shell">
      <section class="auth-card">
        <div class="auth-brand">
          <div class="brand-mark">${icon("book")}</div>
          <div class="auth-brand-copy">
            <strong>六级单词记录</strong>
            <span>CET-6 Vocabulary</span>
          </div>
        </div>
        <h1 class="auth-title">${title}</h1>
        <p class="auth-subtitle">${subtitle}</p>
        <form class="form-stack" data-form="auth" data-mode="${mode}">
          ${
            isRegister
              ? `
                <div class="field">
                  <label for="invite-code">邀请码</label>
                  <input class="input" id="invite-code" name="inviteCode" autocomplete="off" maxlength="16" placeholder="XXXXX-XXXXX" required />
                </div>
              `
              : ""
          }
          ${
            isSetup || isRegister
              ? `
                <div class="form-row">
                  <div class="field">
                    <label for="display-name">显示名称</label>
                    <input class="input" id="display-name" name="displayName" autocomplete="name" maxlength="40" required />
                  </div>
                  <div class="field">
                    <label for="username">账号</label>
                    <input class="input" id="username" name="username" autocomplete="username" minlength="3" maxlength="32" required />
                  </div>
                </div>
              `
              : `
                <div class="field">
                  <label for="username">账号</label>
                  <input class="input" id="username" name="username" autocomplete="username" required />
                </div>
              `
          }
          <div class="field">
            <label for="password">密码</label>
            <input class="input" id="password" name="password" type="password" autocomplete="${isSetup || isRegister ? "new-password" : "current-password"}" minlength="6" maxlength="128" required />
          </div>
          <div class="form-error" aria-live="polite"></div>
          <button class="btn btn-primary btn-block" type="submit">${isSetup ? "创建并开始" : isRegister ? "使用邀请码注册" : "登录"}</button>
        </form>
        ${
          !isSetup && state.registrationEnabled
            ? `
              <button class="auth-switch" type="button" data-action="auth-mode" data-mode="${isRegister ? "login" : "register"}">
                ${isRegister ? "已有账号，返回登录" : "使用邀请码注册"}
              </button>
            `
            : ""
        }
      </section>
    </div>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark">${icon("book")}</div>
        <div class="sidebar-brand-text">
          <strong>六级单词记录</strong>
          <span>CET-6 Vocabulary</span>
        </div>
      </div>
      <nav class="side-nav" aria-label="主导航">
        ${navItems.map(renderNavButton).join("")}
      </nav>
      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="avatar">${escapeHtml(getInitial(state.user?.displayName))}</div>
          <div class="user-copy">
            <strong>${escapeHtml(state.user?.displayName || "")}</strong>
            <span>@${escapeHtml(state.user?.username || "")}</span>
          </div>
        </div>
      </div>
    </aside>
  `;
}

function renderMobileHeader() {
  return `
    <header class="mobile-header">
      <div class="mobile-brand">
        <div class="brand-mark">${icon("book")}</div>
        <span>六级单词记录</span>
      </div>
      <div class="avatar">${escapeHtml(getInitial(state.user?.displayName))}</div>
    </header>
  `;
}

function renderBottomNav() {
  return `
    <nav class="bottom-nav" aria-label="主导航">
      ${navItems.map(renderNavButton).join("")}
    </nav>
  `;
}

function renderNavButton(item) {
  const active = state.view === item.id;
  return `
    <button class="nav-button${active ? " is-active" : ""}" type="button" data-view="${item.id}" aria-current="${active ? "page" : "false"}">
      ${icon(item.icon)}
      <span>${item.label}</span>
    </button>
  `;
}

function renderCurrentView() {
  if (state.view === "study") return renderStudy();
  if (state.view === "lookup") return renderLookup();
  if (state.view === "records") return renderRecords();
  if (state.view === "words") return renderWords();
  if (state.view === "settings") return renderSettings();
  return renderDashboard();
}

function renderLookup() {
  const result = state.lookupResult;
  const local = result?.local;
  const remote = result?.remote;
  const remotePhonetic = remote?.phonetics?.find((item) => item.text)?.text || "";
  const remoteAudio = remote?.phonetics?.find((item) => item.audio)?.audio || "";
  const phonetic = local?.phonetic || remotePhonetic;

  return `
    <header class="page-header">
      <div>
        <h1 class="page-title">查词</h1>
        <p class="page-subtitle">查询中文释义、英文解释与例句</p>
      </div>
    </header>

    <form class="lookup-search" data-form="lookup">
      <div class="search-wrap">
        ${icon("search")}
        <input
          class="input lookup-input"
          id="lookup-input"
          name="word"
          type="search"
          value="${escapeAttribute(state.lookupQuery)}"
          placeholder="输入英文单词"
          autocomplete="off"
          spellcheck="false"
          required
        />
      </div>
      <button class="btn btn-primary" type="submit">${icon("search")}查询</button>
    </form>

    ${
      state.lookupRecent.length
        ? `
          <div class="lookup-recent" aria-label="最近查询">
            ${state.lookupRecent
              .map(
                (word) => `
                  <button class="history-chip" type="button" data-action="lookup-suggestion" data-word="${escapeAttribute(word)}">${escapeHtml(word)}</button>
                `,
              )
              .join("")}
          </div>
        `
        : ""
    }

    ${
      state.lookupLoading
        ? `<div class="loading-block lookup-loading"><div class="spinner"></div></div>`
        : state.lookupError
          ? `<div class="empty-state">${icon("search")}<strong>查询失败</strong><p>${escapeHtml(state.lookupError)}</p></div>`
          : result
            ? renderLookupResult(result, { local, remote, phonetic, remoteAudio })
            : `
              <section class="lookup-intro">
                <div class="lookup-intro-icon">${icon("search", "icon-lg")}</div>
                <h2>输入单词开始查询</h2>
                <p>词库中的 CET-6 单词会同时显示中文释义和掌握状态。</p>
              </section>
            `
    }
  `;
}

function renderLookupResult(result, { local, remote, phonetic, remoteAudio }) {
  if (!local && !remote) {
    return `
      <section class="lookup-result">
        <div class="lookup-word-header">
          <div>
            <h2>${escapeHtml(result.query)}</h2>
            <p>没有找到可用的词典释义</p>
          </div>
        </div>
        ${
          result.suggestions?.length
            ? `
              <div class="lookup-suggestions">
                <span>词库相近词</span>
                <div>
                  ${result.suggestions
                    .map(
                      (word) => `
                        <button class="history-chip" type="button" data-action="lookup-suggestion" data-word="${escapeAttribute(word)}">${escapeHtml(word)}</button>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      </section>
    `;
  }

  return `
    <div class="lookup-result">
      <section class="lookup-word-header">
        <div class="lookup-word-main">
          <div class="word-topline lookup-badges">
            ${local ? `<span class="badge badge-${local.mastery}">${masteryLabels[local.mastery]}</span>` : ""}
            ${local ? `<span class="badge">CET-6 词库</span>` : ""}
            ${remote ? `<span class="badge badge-new">在线词典</span>` : ""}
          </div>
          <h2>${escapeHtml(local?.word || result.query)}</h2>
          <div class="lookup-phonetic-row">
            ${phonetic ? `<span>${escapeHtml(phonetic)}</span>` : ""}
            <button class="icon-btn" type="button" data-action="${remoteAudio ? "play-audio" : "speak"}" ${remoteAudio ? `data-url="${escapeAttribute(remoteAudio)}"` : `data-word="${escapeAttribute(local?.word || result.query)}"`} aria-label="播放发音">
              ${icon("volume", "icon-sm")}
            </button>
          </div>
        </div>
      </section>

      ${
        local
          ? `
            <section class="panel lookup-block">
              <div class="section-heading">
                <div>
                  <h2>词库释义</h2>
                  <p>${escapeHtml(local.partOfSpeech || "中文释义")}</p>
                </div>
                <span class="badge">${formatNextReview(local)}</span>
              </div>
              <p class="lookup-meaning">${escapeHtml(local.meaning)}</p>
              ${
                local.example
                  ? `
                    <div class="lookup-example">
                      ${escapeHtml(local.example)}
                      ${local.exampleTranslation ? `<span>${escapeHtml(local.exampleTranslation)}</span>` : ""}
                    </div>
                  `
                  : ""
              }
              <div class="detail-stats">
                <span class="badge">学习 ${local.reviewCount} 次</span>
                <span class="badge">认识 ${local.knownCount} 次</span>
              </div>
            </section>
          `
          : ""
      }

      ${
        remote?.meanings?.length
          ? `
            <section class="panel lookup-block">
              <div class="section-heading">
                <div>
                  <h2>英文释义</h2>
                  <p>${remote.meanings.length} 组词义</p>
                </div>
              </div>
              <div class="definition-groups">
                ${remote.meanings
                  .map(
                    (meaning) => `
                      <div class="definition-group">
                        <span class="definition-pos">${escapeHtml(meaning.partOfSpeech || "word")}</span>
                        <ol>
                          ${meaning.definitions
                            .map(
                              (item) => `
                                <li>
                                  <p>${escapeHtml(item.definition)}</p>
                                  ${item.example ? `<blockquote>${escapeHtml(item.example)}</blockquote>` : ""}
                                </li>
                              `,
                            )
                            .join("")}
                        </ol>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </section>
          `
          : ""
      }

      ${
        remote?.synonyms?.length || remote?.antonyms?.length
          ? `
            <section class="panel lookup-block">
              ${
                remote.synonyms?.length
                  ? `
                    <div class="section-heading">
                      <div><h2>同义词</h2></div>
                    </div>
                    <div class="word-tags">${remote.synonyms.map((word) => `<button class="history-chip" type="button" data-action="lookup-suggestion" data-word="${escapeAttribute(word)}">${escapeHtml(word)}</button>`).join("")}</div>
                  `
                  : ""
              }
              ${
                remote.antonyms?.length
                  ? `
                    <div class="section-heading lookup-subheading">
                      <div><h2>反义词</h2></div>
                    </div>
                    <div class="word-tags">${remote.antonyms.map((word) => `<button class="history-chip" type="button" data-action="lookup-suggestion" data-word="${escapeAttribute(word)}">${escapeHtml(word)}</button>`).join("")}</div>
                  `
                  : ""
              }
            </section>
          `
          : ""
      }

      ${
        result.remoteStatus === "unavailable"
          ? `<div class="lookup-offline-note">在线词典暂时不可用，当前显示词库结果。</div>`
          : ""
      }
    </div>
  `;
}

function renderDashboard() {
  const dashboard = state.dashboard;
  const totalTasks = dashboard.due + dashboard.newRemaining;
  const reinforcementDue = Number(dashboard.reinforcementDue || 0);
  const secondDayDue = Number(dashboard.secondDayDue || 0);
  const knownRate =
    dashboard.todayStudied > 0
      ? Math.round((dashboard.knownAnswersToday / dashboard.todayStudied) * 100)
      : 0;
  const learnedPercent =
    dashboard.totalWords > 0
      ? Math.round((dashboard.learned / dashboard.totalWords) * 100)
      : 0;

  return `
    <header class="page-header">
      <div>
        <h1 class="page-title">今天</h1>
        <p class="page-subtitle">${formatChineseDate(dashboard.today)}</p>
      </div>
      <span class="badge badge-familiar">${dashboard.streak} 天连续</span>
    </header>

    <div class="dashboard-grid">
      <section class="start-panel" aria-labelledby="today-task-title">
        <div>
          <div class="start-kicker" id="today-task-title">今日任务</div>
          <div class="start-number">
            <strong>${totalTasks}</strong>
            <span>个单词待完成</span>
          </div>
          <p class="start-description">
            ${dashboard.due} 个复习 · ${dashboard.newRemaining} 个新词${
              secondDayDue > 0 ? ` · ${secondDayDue} 个次日复习` : ""
            }
          </p>
          <div class="start-progress">
            <div class="progress-meta">
              <span>新词计划</span>
              <span>${dashboard.newToday} / ${dashboard.dailyGoal}</span>
            </div>
            <div class="progress-track" aria-label="今日新词进度">
              <div class="progress-fill" style="width:${dashboard.progressPercent}%"></div>
            </div>
          </div>
        </div>
        <div class="start-actions">
          <button class="btn btn-primary" type="button" data-action="start-study" ${totalTasks === 0 ? "disabled" : ""}>
            ${icon("layers")}
            ${totalTasks === 0 ? "今日已完成" : "开始学习"}
          </button>
          <span class="muted" style="font-size:12px;text-align:center;">每组最多 30 个</span>
        </div>
      </section>

      <section class="stat-grid" aria-label="今日数据">
        <article class="stat-card">
          <div class="stat-top">
            <span>今日新学</span>
            <span class="stat-icon">${icon("book", "icon-sm")}</span>
          </div>
          <strong class="stat-value">${dashboard.newToday}</strong>
          <span class="stat-note">计划 ${dashboard.dailyGoal}</span>
        </article>
        <article class="stat-card">
          <div class="stat-top">
            <span>待复习</span>
            <span class="stat-icon is-orange">${icon("clock", "icon-sm")}</span>
          </div>
          <strong class="stat-value">${dashboard.due}</strong>
          <span class="stat-note">${reinforcementDue > 0 ? `${reinforcementDue} 个需强化` : "到期单词"}</span>
        </article>
        <article class="stat-card">
          <div class="stat-top">
            <span>今日掌握率</span>
            <span class="stat-icon is-blue">${icon("target", "icon-sm")}</span>
          </div>
          <strong class="stat-value">${knownRate}%</strong>
          <span class="stat-note">${dashboard.knownAnswersToday} 次选择“认识”</span>
        </article>
        <article class="stat-card">
          <div class="stat-top">
            <span>累计学习</span>
            <span class="stat-icon">${icon("trend", "icon-sm")}</span>
          </div>
          <strong class="stat-value">${dashboard.learned}</strong>
          <span class="stat-note">词库共 ${dashboard.totalWords} 个</span>
        </article>
      </section>

      <div class="dashboard-lower">
        <section class="panel">
          <div class="section-heading">
            <div>
              <h2>掌握进度</h2>
              <p>已学习 ${dashboard.learned} 个，占词库 ${learnedPercent}%</p>
            </div>
          </div>
          ${renderDistribution(dashboard)}
        </section>
        <section class="panel">
          <div class="section-heading">
            <div>
              <h2>今日记录</h2>
              <p>${dashboard.todayStudied} 个单词已作答</p>
            </div>
          </div>
          <div class="next-review-list">
            <div class="plain-row">
              <div class="plain-row-main">
                <span class="stat-icon">${icon("book", "icon-sm")}</span>
                <div><strong>新词</strong><span>今日首次学习</span></div>
              </div>
              <strong>${dashboard.newToday}</strong>
            </div>
            <div class="plain-row">
              <div class="plain-row-main">
                <span class="stat-icon is-orange">${icon("rotate", "icon-sm")}</span>
                <div><strong>复习</strong><span>已完成作答</span></div>
              </div>
              <strong>${dashboard.reviewAnswersToday}</strong>
            </div>
            <div class="plain-row">
              <div class="plain-row-main">
                <span class="stat-icon is-blue">${icon("flame", "icon-sm")}</span>
                <div><strong>连续学习</strong><span>保持当前节奏</span></div>
              </div>
              <strong>${dashboard.streak} 天</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderDistribution(dashboard) {
  const total = Math.max(1, dashboard.learned);
  const rows = [
    { label: "学习中", value: dashboard.learning, className: "learning" },
    { label: "熟悉", value: dashboard.familiar, className: "familiar" },
    { label: "掌握", value: dashboard.mastered, className: "mastered" },
  ];

  return `
    <div class="distribution">
      ${rows
        .map(
          (row) => `
            <div class="distribution-row">
              <span>${row.label}</span>
              <div class="mini-track">
                <div class="mini-fill ${row.className}" style="width:${Math.round((row.value / total) * 100)}%"></div>
              </div>
              <strong>${row.value}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderStudy() {
  if (state.studyLoading) {
    return `
      <div class="study-view">
        <div class="study-stage">
          <div class="loading-block"><div class="spinner"></div></div>
        </div>
      </div>
    `;
  }

  if (state.studyComplete) {
    const unknown = state.sessionResults.filter((item) => item.result === "unknown").length;
    const fuzzy = state.sessionResults.filter((item) => item.result === "fuzzy").length;
    const known = state.sessionResults.filter((item) => item.result === "known").length;
    return `
      <div class="study-view">
        <div class="session-done">
          <div class="done-icon">${icon("check", "icon-lg")}</div>
          <h1>${state.sessionResults.length ? "这一组完成" : "今日任务完成"}</h1>
          <p>${state.sessionResults.length ? `完成 ${state.sessionResults.length} 个单词` : "当前没有到期复习或新词。"}</p>
          ${
            state.sessionResults.length
              ? `
                <div class="session-summary">
                  <div class="summary-cell"><strong>${unknown}</strong><span>不认识</span></div>
                  <div class="summary-cell"><strong>${fuzzy}</strong><span>模糊</span></div>
                  <div class="summary-cell"><strong>${known}</strong><span>认识</span></div>
                </div>
              `
              : ""
          }
          <div class="session-actions">
            <button class="btn" type="button" data-action="exit-study">${icon("arrow-left")}回到今日</button>
            <button class="btn btn-primary" type="button" data-action="study-again">${icon("rotate")}再学一组</button>
          </div>
        </div>
      </div>
    `;
  }

  const item = state.queue[state.studyIndex];
  if (!item) {
    return `
      <div class="study-view">
        <div class="session-done">
          <div class="done-icon">${icon("check", "icon-lg")}</div>
          <h1>今日任务完成</h1>
          <p>当前没有待学习内容。</p>
          <div class="session-actions">
            <button class="btn btn-primary" type="button" data-action="exit-study">回到今日</button>
          </div>
        </div>
      </div>
    `;
  }

  const progressPercent = Math.round((state.studyIndex / state.queue.length) * 100);
  const isNewItem = item.itemType === "new";
  const isSecondDay = item.itemType === "second_day";
  const isReinforced = Boolean(item.reinforcement);
  const itemShortLabel = isNewItem
    ? "新词"
    : isReinforced
      ? "强化"
      : isSecondDay
        ? "次日"
        : "复习";
  const itemLabel = isNewItem
    ? "新词"
    : isReinforced
      ? "强化复习"
      : isSecondDay
        ? "次日复习"
        : "到期复习";
  const itemBadgeClass = isNewItem
    ? "badge-new"
    : isReinforced
      ? "badge-learning"
      : isSecondDay
        ? "badge-familiar"
        : "badge-due";
  return `
    <div class="study-view">
      <div class="study-topbar">
        <button class="icon-btn" type="button" data-action="exit-study" aria-label="退出学习">
          ${icon("arrow-left")}
        </button>
        <div class="study-progress-copy">
          <strong>${state.studyIndex + 1} / ${state.queue.length}</strong>
          <span>${itemShortLabel}</span>
        </div>
        <div class="study-tools">
          <button class="icon-btn" type="button" data-action="shuffle-queue" aria-label="重新打乱剩余单词" title="重新打乱剩余单词">
            ${icon("shuffle")}
          </button>
          <div class="icon-btn" aria-hidden="true">
            <svg class="icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" pathLength="100" fill="none" stroke="var(--surface-3)" stroke-width="3" />
              <circle cx="12" cy="12" r="9" pathLength="100" fill="none" stroke="var(--brand)" stroke-width="3" stroke-dasharray="${progressPercent} 100" transform="rotate(-90 12 12)" />
            </svg>
          </div>
        </div>
      </div>

      <section class="study-stage">
        <article class="word-card">
          <div class="word-topline">
            <span class="badge ${itemBadgeClass}">
              ${itemLabel}
            </span>
            ${item.partOfSpeech ? `<span class="badge">${escapeHtml(item.partOfSpeech)}</span>` : ""}
          </div>
          <div class="word-spelling-row">
            <h1 class="word-spelling">${escapeHtml(item.word)}</h1>
            <button class="speak-button" type="button" data-action="speak" data-word="${escapeAttribute(item.word)}" aria-label="朗读单词">
              ${icon("volume")}
            </button>
          </div>
          ${item.phonetic ? `<div class="word-phonetic">${escapeHtml(item.phonetic)}</div>` : ""}
          ${
            state.revealed
              ? `
                <div class="answer-panel">
                  <p class="answer-meaning">${escapeHtml(item.meaning)}</p>
                  ${
                    item.example
                      ? `
                        <div class="answer-example">
                          ${escapeHtml(item.example)}
                          ${item.exampleTranslation ? `<span>${escapeHtml(item.exampleTranslation)}</span>` : ""}
                        </div>
                      `
                      : ""
                  }
                </div>
              `
              : `
                <button class="btn btn-primary reveal-button" type="button" data-action="show-answer">
                  ${icon("layers")}显示答案
                </button>
              `
          }
        </article>
      </section>

      <div class="study-actions">
        ${
          state.revealed
            ? `
              <div class="review-grid">
                <button class="review-button unknown" type="button" data-action="review" data-result="unknown" ${state.savingReview ? "disabled" : ""}>
                  <span>不认识</span><small>按键 1</small>
                </button>
                <button class="review-button fuzzy" type="button" data-action="review" data-result="fuzzy" ${state.savingReview ? "disabled" : ""}>
                  <span>模糊</span><small>按键 2</small>
                </button>
                <button class="review-button known" type="button" data-action="review" data-result="known" ${state.savingReview ? "disabled" : ""}>
                  <span>认识</span><small>按键 3</small>
                </button>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderRecords() {
  if (state.recordsLoading || !state.records) {
    return `
      <header class="page-header">
        <div>
          <h1 class="page-title">记录</h1>
          <p class="page-subtitle">最近 12 周</p>
        </div>
      </header>
      <div class="loading-block"><div class="spinner"></div></div>
    `;
  }

  const records = state.records;
  const totalStudied = records.daily.reduce((sum, row) => sum + row.studied, 0);
  const totalNew = records.daily.reduce((sum, row) => sum + row.newWords, 0);
  const totalReviews = records.daily.reduce((sum, row) => sum + row.reviews, 0);
  const heatCells = buildHeatmapCells(records);
  const weekData = buildWeeklyData(records);
  const maxWeek = Math.max(1, ...weekData.map((item) => item.value));

  return `
    <header class="page-header">
      <div>
        <h1 class="page-title">记录</h1>
        <p class="page-subtitle">最近 12 周的学习轨迹</p>
      </div>
      <span class="badge badge-familiar">${state.dashboard.streak} 天连续</span>
    </header>

    <div class="records-stack">
      <section class="stat-grid" aria-label="学习汇总">
        <article class="stat-card">
          <div class="stat-top"><span>学习单词</span><span class="stat-icon">${icon("book", "icon-sm")}</span></div>
          <strong class="stat-value">${totalStudied}</strong>
          <span class="stat-note">去重后的单词</span>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span>新学</span><span class="stat-icon is-blue">${icon("plus", "icon-sm")}</span></div>
          <strong class="stat-value">${totalNew}</strong>
          <span class="stat-note">首次学习</span>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span>复习</span><span class="stat-icon is-orange">${icon("rotate", "icon-sm")}</span></div>
          <strong class="stat-value">${totalReviews}</strong>
          <span class="stat-note">复习作答次数</span>
        </article>
        <article class="stat-card">
          <div class="stat-top"><span>已掌握</span><span class="stat-icon">${icon("check", "icon-sm")}</span></div>
          <strong class="stat-value">${state.dashboard.mastered}</strong>
          <span class="stat-note">当前掌握状态</span>
        </article>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>学习热力图</h2>
            <p>颜色越深，当天学习的单词越多</p>
          </div>
        </div>
        <div class="heatmap-scroll">
          <div class="heatmap-grid">
            ${heatCells
              .map(
                (cell) => `
                  <div class="heat-cell" data-level="${cell.level}" style="grid-row:${cell.weekday + 1}" title="${cell.date}: ${cell.count} 个单词"></div>
                `,
              )
              .join("")}
          </div>
        </div>
        <div class="heat-legend">
          <span>少</span>
          <span class="heat-cell" data-level="0"></span>
          <span class="heat-cell" data-level="1"></span>
          <span class="heat-cell" data-level="2"></span>
          <span class="heat-cell" data-level="3"></span>
          <span class="heat-cell" data-level="4"></span>
          <span>多</span>
        </div>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>近 7 天</h2>
            <p>每天学习的单词数量</p>
          </div>
        </div>
        <div class="weekly-chart">
          ${weekData
            .map(
              (item) => `
                <div class="bar-column">
                  <div class="bar-track">
                    <div class="bar-fill" style="height:${Math.max(3, Math.round((item.value / maxWeek) * 100))}%"></div>
                  </div>
                  <span>${item.label}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>最近学习</h2>
            <p>最新的 24 次作答</p>
          </div>
        </div>
        ${
          records.recent.length
            ? `
              <div class="recent-list">
                ${records.recent
                  .map(
                    (item) => `
                      <div class="recent-row">
                        <div class="recent-word">
                          <strong>${escapeHtml(item.word)}</strong>
                          <span>${formatShortDateTime(item.createdAt)}</span>
                        </div>
                        <div class="recent-result">${escapeHtml(item.meaning)}</div>
                        <span class="badge ${item.result === "known" ? "badge-mastered" : item.result === "fuzzy" ? "badge-learning" : "badge-due"}">${resultLabels[item.result]}</span>
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            `
            : `<div class="empty-state">${icon("calendar")}<strong>还没有学习记录</strong><p>完成第一组单词后会显示在这里。</p></div>`
        }
      </section>
    </div>
  `;
}

function renderWords() {
  const words = state.words?.items || [];
  return `
    <header class="page-header">
      <div>
        <h1 class="page-title">词库</h1>
        <p class="page-subtitle">搜索、筛选并查看每个词的学习状态</p>
      </div>
      <button class="btn" type="button" data-action="open-import">${icon("import")}导入 CSV</button>
    </header>

    <div class="toolbar">
      <div class="search-wrap">
        ${icon("search")}
        <input
          class="input"
          id="word-search"
          data-action="word-search"
          type="search"
          value="${escapeAttribute(state.wordQuery)}"
          placeholder="搜索单词或释义"
          autocomplete="off"
        />
      </div>
      <div class="segmented" role="tablist" aria-label="词库筛选">
        ${filterItems
          .map(
            (filter) => `
              <button class="segment-button${state.wordFilter === filter.id ? " is-active" : ""}" type="button" role="tab" aria-selected="${state.wordFilter === filter.id}" data-action="set-filter" data-filter="${filter.id}">
                ${filter.label}
              </button>
            `,
          )
          .join("")}
      </div>
    </div>

    ${
      state.wordsLoading || !state.words
        ? `<div class="loading-block"><div class="spinner"></div></div>`
        : words.length
          ? `
            <div class="word-list">
              ${words.map(renderWordRow).join("")}
            </div>
          `
          : `
            <div class="empty-state">
              ${icon("search")}
              <strong>没有找到单词</strong>
              <p>尝试更换搜索词或筛选条件。</p>
            </div>
          `
    }
  `;
}

function renderWordRow(item) {
  const expanded = state.expandedWord === item.id;
  const isDue =
    item.nextReviewAt &&
    new Date(item.nextReviewAt).getTime() <= Date.now();
  const needsReinforcement = Number(item.reinforcementLevel || 0) > 0;
  const badgeClass = needsReinforcement
    ? "badge-learning"
    : isDue
      ? "badge-due"
      : `badge-${item.mastery || "new"}`;
  const badgeText = needsReinforcement
    ? "需强化"
    : isDue
      ? "待复习"
      : masteryLabels[item.mastery] || "未学习";

  return `
    <article class="word-row">
      <button class="word-row-button" type="button" data-action="toggle-word" data-id="${item.id}" aria-expanded="${expanded}">
        <div class="word-row-word">
          <strong>${escapeHtml(item.word)}</strong>
          <span>${escapeHtml(item.phonetic || item.partOfSpeech || "")}</span>
        </div>
        <div class="word-row-meaning">${escapeHtml(item.meaning)}</div>
        <span class="badge ${badgeClass}">${badgeText}</span>
        <span class="word-row-next">${formatNextReview(item)}</span>
      </button>
      ${
        expanded
          ? `
            <div class="word-detail">
              <div class="word-detail-inner">
                <div class="detail-meta">
                  ${item.partOfSpeech ? `<span>${escapeHtml(item.partOfSpeech)}</span>` : ""}
                  ${item.phonetic ? `<span>${escapeHtml(item.phonetic)}</span>` : ""}
                  <button class="icon-btn" type="button" data-action="speak" data-word="${escapeAttribute(item.word)}" aria-label="朗读单词">${icon("volume", "icon-sm")}</button>
                </div>
                ${
                  item.example
                    ? `
                      <p class="detail-example">
                        ${escapeHtml(item.example)}
                        ${item.exampleTranslation ? `<span>${escapeHtml(item.exampleTranslation)}</span>` : ""}
                      </p>
                    `
                    : ""
                }
                <div class="detail-stats">
                  <span class="badge">学习 ${item.reviewCount} 次</span>
                  <span class="badge">认识 ${item.knownCount} 次</span>
                  ${needsReinforcement ? `<span class="badge badge-learning">下次强化 ${Number(item.reinforcementLevel || 0) + 1} 次</span>` : ""}
                  <span class="badge">${formatNextReview(item)}</span>
                </div>
              </div>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderSettings() {
  return `
    <header class="page-header">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-subtitle">账号与每日学习计划</p>
      </div>
    </header>

    <div class="settings-stack">
      <section class="panel">
        <div class="settings-profile">
          <div class="avatar">${escapeHtml(getInitial(state.user?.displayName))}</div>
          <div>
            <strong>${escapeHtml(state.user?.displayName || "")}</strong>
            <span>@${escapeHtml(state.user?.username || "")}</span>
          </div>
        </div>
      </section>

      <form class="panel form-stack" data-form="settings">
        <div class="field">
          <label for="display-name-setting">显示名称</label>
          <input class="input" id="display-name-setting" name="displayName" maxlength="40" value="${escapeAttribute(state.user?.displayName || "")}" required />
        </div>
        <div class="field">
          <span class="field-label">每日新词目标</span>
          <div class="goal-control">
            <button class="icon-btn" type="button" data-action="goal-step" data-step="-5" aria-label="减少五个">${icon("minus")}</button>
            <input class="input" id="daily-goal" name="dailyGoal" type="number" min="5" max="200" step="5" value="${Number(state.user?.dailyGoal || 30)}" />
            <button class="icon-btn" type="button" data-action="goal-step" data-step="5" aria-label="增加五个">${icon("plus")}</button>
          </div>
        </div>
        <div class="settings-actions">
          <button class="btn btn-primary" type="submit">保存设置</button>
        </div>
      </form>

      ${state.user?.isAdmin ? renderInviteAdmin() : ""}

      ${
        offlineMode
          ? renderOfflineSettings()
          : `
            <section class="panel">
              <button class="btn btn-danger btn-block" type="button" data-action="logout">
                ${icon("logout")}退出登录
              </button>
            </section>
          `
      }
    </div>
  `;
}

function renderOfflineSettings() {
  return `
    <section class="panel">
      <div class="section-heading">
        <div>
          <h2>本机数据</h2>
          <p>学习进度只保存在这台设备上</p>
        </div>
      </div>
      <div class="offline-data-actions">
        <button class="btn" type="button" data-action="export-offline-data">${icon("import")}导出备份</button>
        <button class="btn" type="button" data-action="import-offline-data">${icon("upload")}导入备份</button>
        <button class="btn btn-danger" type="button" data-action="reset-offline-data">${icon("x")}清空数据</button>
      </div>
      <input class="sr-only" id="offline-import-file" type="file" accept="application/json,.json" />
    </section>
  `;
}

function renderInviteAdmin() {
  const invites = state.invites || [];
  return `
    <section class="panel">
      <div class="section-heading">
        <div>
          <h2>邀请码</h2>
          <p>只有拿到邀请码的人才能创建账号</p>
        </div>
      </div>

      <form class="invite-form" data-form="invite">
        <div class="field">
          <label for="invite-label">备注</label>
          <input class="input" id="invite-label" name="label" maxlength="60" placeholder="例如：朋友 A" />
        </div>
        <div class="invite-form-row">
          <div class="field">
            <label for="invite-max-uses">可用次数</label>
            <input class="input" id="invite-max-uses" name="maxUses" type="number" min="1" max="100" value="1" />
          </div>
          <div class="field">
            <label for="invite-expiry">有效天数</label>
            <input class="input" id="invite-expiry" name="expiresInDays" type="number" min="0" max="365" value="30" />
          </div>
          <button class="btn btn-primary" type="submit">${icon("plus")}生成邀请码</button>
        </div>
      </form>

      ${
        state.invitesLoading
          ? `<div class="invite-loading"><div class="spinner"></div></div>`
          : invites.length
            ? `
              <div class="invite-list">
                ${invites
                  .map(
                    (invite) => `
                      <div class="invite-row">
                        <div class="invite-main">
                          <strong>${escapeHtml(invite.code)}</strong>
                          <span>${escapeHtml(invite.label || "无备注")} · ${invite.usedCount}/${invite.maxUses} 次</span>
                        </div>
                        <span class="badge ${invite.active ? "badge-familiar" : "badge-due"}">${invite.active ? "可用" : invite.revokedAt ? "已撤销" : invite.expired ? "已过期" : "已用完"}</span>
                        <span class="invite-expiry">${formatInviteExpiry(invite)}</span>
                        <button class="icon-btn" type="button" data-action="copy-invite" data-code="${escapeAttribute(invite.code)}" aria-label="复制邀请码" title="复制邀请码">${icon("copy", "icon-sm")}</button>
                        ${invite.active ? `<button class="btn btn-ghost invite-revoke" type="button" data-action="revoke-invite" data-id="${invite.id}">撤销</button>` : ""}
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            `
            : `<div class="invite-empty">还没有邀请码。</div>`
      }
    </section>
  `;
}

function renderModal() {
  if (state.modal !== "import") return "";
  return `
    <div class="modal-backdrop" data-modal-backdrop>
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div class="modal-header">
          <div>
            <h2 id="import-title">导入词库</h2>
            <p>CSV 支持 word、phonetic、part_of_speech、meaning、example、example_translation 字段。</p>
          </div>
          <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭">${icon("x")}</button>
        </div>
        <form class="form-stack" data-form="import">
          <div class="field">
            <label for="csv-file">CSV 文件</label>
            <input class="input file-input" id="csv-file" name="csvFile" type="file" accept=".csv,text/csv" />
          </div>
          <div class="field">
            <label for="csv-text">或粘贴 CSV</label>
            <textarea class="textarea" id="csv-text" name="csvText" placeholder="word,meaning&#10;abandon,放弃"></textarea>
          </div>
          <div class="modal-actions">
            <button class="btn" type="button" data-action="close-modal">取消</button>
            <button class="btn btn-primary" type="submit">${icon("upload")}导入</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function buildHeatmapCells(records) {
  const dailyMap = new Map(records.daily.map((item) => [item.date, item]));
  const start = parseLocalDate(records.startDate);
  const cells = [];

  for (let offset = 0; offset < records.days; offset += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + offset);
    const key = formatDateKey(date);
    const data = dailyMap.get(key);
    const count = data?.studied || 0;
    const level = count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(count / 8)));
    cells.push({
      date: key,
      weekday: date.getDay(),
      count,
      level,
    });
  }

  return cells;
}

function buildWeeklyData(records) {
  const dailyMap = new Map(records.daily.map((item) => [item.date, item]));
  const today = parseLocalDate(records.today);
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  const items = [];

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = formatDateKey(date);
    items.push({
      label: labels[date.getDay()],
      value: dailyMap.get(key)?.studied || 0,
    });
  }

  return items;
}

function formatNextReview(item) {
  if (!item.nextReviewAt) return "未学习";
  const due = new Date(item.nextReviewAt);
  if (due.getTime() <= Date.now()) return "待复习";
  return `${due.getMonth() + 1}月${due.getDate()}日`;
}

function formatChineseDate(value) {
  const date = parseLocalDate(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(date);
}

function formatShortDateTime(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatInviteExpiry(invite) {
  if (!invite.expiresAt) return "永不过期";
  const date = new Date(invite.expiresAt);
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
  return invite.expired ? `${formatted} 已过期` : `${formatted} 到期`;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value)
    .split("-")
    .map((part) => Number(part));
  return new Date(year, month - 1, day);
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getInitial(name) {
  return String(name || "C").trim().slice(0, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function shuffleArray(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function icon(name, className = "") {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function restoreFocus() {
  if (!state.focusId) return;
  const element = document.getElementById(state.focusId);
  if (element) {
    element.focus();
    if (typeof element.setSelectionRange === "function") {
      const length = element.value.length;
      element.setSelectionRange(length, length);
    }
  }
  state.focusId = null;
}

bootstrap();
