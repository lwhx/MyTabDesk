(function (root) {
  const CONFIG_KEY = "mytabdesk_ai_grouping_config";
  const REQUEST_TIMEOUT_MS = 20000;
  const DEFAULT_CONFIG = {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKey: ""
  };

  function getCore() {
    const core = root.MyTabDeskCoreAiGrouping;
    if (!core) throw new Error("AI 分组核心模块尚未加载。");
    return core;
  }

  function normalizeConfig(config) {
    const raw = config && typeof config === "object" ? config : {};
    return {
      baseUrl: String(raw.baseUrl || DEFAULT_CONFIG.baseUrl).trim().replace(/\/+$/, ""),
      model: String(raw.model || DEFAULT_CONFIG.model).trim(),
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey.trim() : ""
    };
  }

  function getStorage() {
    if (!root.chrome?.storage?.local) throw new Error("当前环境不支持本地 AI 配置存储。");
    return root.chrome.storage.local;
  }

  function validateBaseUrl(baseUrl) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error("AI 接口地址格式无效。");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("AI 接口地址只支持 HTTP 或 HTTPS。");
    }
  }

  async function loadConfig() {
    const result = await getStorage().get(CONFIG_KEY);
    return normalizeConfig(result && result[CONFIG_KEY]);
  }

  async function saveConfig(config) {
    const normalized = normalizeConfig(config);
    await getStorage().set({ [CONFIG_KEY]: normalized });
    return normalized;
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  }

  function buildInput(data, spaceId) {
    const spaces = data && Array.isArray(data.spaces) ? data.spaces : [];
    const targetSpaceId = spaceId || data?.activeSpaceId;
    const space = spaces.find((item) => item.id === targetSpaceId && !item.deletedAt);
    if (!space) throw new Error("找不到要进行 AI 分组的空间。");
    const links = [];
    for (const group of Array.isArray(space.groups) ? space.groups : []) {
      if (group.deletedAt) continue;
      for (const link of Array.isArray(group.links) ? group.links : []) {
        if (link.deletedAt || typeof link.id !== "string" || !link.id) continue;
        links.push({
          id: link.id,
          title: String(link.title || "未命名链接").trim(),
          domain: extractDomain(link.url)
        });
      }
    }
    if (links.length === 0) throw new Error("当前空间没有可分组的链接。");
    return { links };
  }

  function sanitizeInput(input) {
    const links = Array.isArray(input?.links) ? input.links : [];
    return {
      links: links.map((link) => ({
        id: typeof link?.id === "string" ? link.id : "",
        title: typeof link?.title === "string" ? link.title : "",
        domain: typeof link?.domain === "string" ? link.domain : ""
      })).filter((link) => link.id)
    };
  }

  function createMessages(input) {
    return [
      {
        role: "system",
        content: "你是书签整理助手。请根据标题和域名建议分组。只返回 JSON 对象，格式为 {\"groups\":[{\"name\":\"分组名\",\"linkIds\":[\"链接ID\"]}]}。每个链接最多出现一次，不要虚构链接ID。"
      },
      {
        role: "user",
        content: JSON.stringify({ links: input.links })
      }
    ];
  }

  function supportsFormatRetry(status, responseText) {
    if (status !== 400 || typeof responseText !== "string") return false;
    const formatName = "(?:response_format|json[_ -]?object|json mode)";
    const unsupported = "(?:not supported|unsupported|does not support|unknown parameter|unrecognized|not allowed)";
    return new RegExp(`${formatName}[\\s\\S]{0,160}${unsupported}|${unsupported}[\\s\\S]{0,160}${formatName}`, "i")
      .test(responseText);
  }

  function createHttpError(status) {
    if (status === 401) return new Error("AI 服务认证失败，请检查 API Key。");
    if (status === 403) return new Error("AI 服务拒绝访问，请检查 API Key 权限或模型权限。");
    if (status === 429) return new Error("AI 服务请求过于频繁或额度不足，请稍后重试。");
    return new Error(`AI 服务请求失败（HTTP ${status}）。`);
  }

  async function postChatCompletion(config, body, signal) {
    let response;
    try {
      response = await root.fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("AI 服务请求超时（20 秒），请稍后重试。", { cause: error });
      }
      throw new Error("无法连接 AI 服务，请检查网络和接口地址。", { cause: error });
    }
    try {
      const responseText = await response.text();
      return { response, responseText };
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error("AI 服务请求超时（20 秒），请稍后重试。", { cause: error });
      }
      throw new Error("读取 AI 服务响应失败，请稍后重试。", { cause: error });
    }
  }

  function parseResponseBody(responseText) {
    try {
      return JSON.parse(responseText);
    } catch {
      throw new Error("AI 服务返回了无法解析的响应。");
    }
  }

  async function requestSuggestions(config, input) {
    const normalizedConfig = normalizeConfig(config);
    validateBaseUrl(normalizedConfig.baseUrl);
    if (!normalizedConfig.baseUrl) throw new Error("请填写 AI 接口地址。");
    if (!normalizedConfig.model) throw new Error("请填写 AI 模型名称。");
    if (!normalizedConfig.apiKey) throw new Error("请填写 AI API Key。");
    const safeInput = sanitizeInput(input);
    if (safeInput.links.length === 0) {
      throw new Error("没有可发送给 AI 的链接信息。");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const baseBody = {
      model: normalizedConfig.model,
      messages: createMessages(safeInput)
    };
    try {
      let result = await postChatCompletion(normalizedConfig, {
        ...baseBody,
        response_format: { type: "json_object" }
      }, controller.signal);
      if (!result.response.ok && supportsFormatRetry(result.response.status, result.responseText)) {
        result = await postChatCompletion(normalizedConfig, baseBody, controller.signal);
      }
      if (!result.response.ok) throw createHttpError(result.response.status);

      const payload = parseResponseBody(result.responseText);
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("AI 服务没有返回分组内容。");
      }
      const raw = getCore().parseAiGroupingResponse(content);
      return getCore().validateAiGroupingSuggestions(raw, safeInput.links.map((link) => link.id));
    } finally {
      clearTimeout(timer);
    }
  }

  function applyConfirmedSuggestions(data, spaceId, suggestions) {
    return getCore().applyAiGroupingSuggestions(data, spaceId, suggestions);
  }

  let pendingSuggestions = null;

  async function loadConfigToForm() {
    const config = await loadConfig();
    const elements = root.MyTabDeskPage.elements;
    elements.aiGroupingBaseUrlInput.value = config.baseUrl;
    elements.aiGroupingModelInput.value = config.model;
    elements.aiGroupingApiKeyInput.value = config.apiKey;
  }

  async function saveConfigFromForm() {
    const elements = root.MyTabDeskPage.elements;
    validateBaseUrl(elements.aiGroupingBaseUrlInput.value);
    await saveConfig({ baseUrl: elements.aiGroupingBaseUrlInput.value, model: elements.aiGroupingModelInput.value, apiKey: elements.aiGroupingApiKeyInput.value });
    root.MyTabDeskNotifications.showToast("AI 分组配置已保存", "success");
  }

  function closePreview() {
    pendingSuggestions = null;
    root.MyTabDeskPage.elements.aiGroupingPreviewDialog.hidden = true;
  }

  function renderPreview(suggestions) {
    const elements = root.MyTabDeskPage.elements;
    elements.aiGroupingPreviewList.replaceChildren();
    for (const group of suggestions.groups) {
      const item = document.createElement("div");
      item.className = "ai-grouping-preview-item";
      const name = document.createElement("strong");
      name.textContent = group.name;
      const count = document.createElement("span");
      count.textContent = `${group.linkIds.length} 个链接`;
      item.append(name, count);
      elements.aiGroupingPreviewList.appendChild(item);
    }
    elements.aiGroupingPreviewDialog.hidden = false;
  }

  async function runGrouping() {
    try {
      const app = root.MyTabDeskPage;
      const input = buildInput(app.state.data, app.state.data.activeSpaceId);
      pendingSuggestions = await requestSuggestions(await loadConfig(), input);
      renderPreview(pendingSuggestions);
    } catch (error) {
      await root.MyTabDeskDialogs.showAlert(error.message || "AI 分组失败。", "AI 分组");
    }
  }

  async function confirmGrouping() {
    if (!pendingSuggestions) return;
    const app = root.MyTabDeskPage;
    app.state.data = applyConfirmedSuggestions(app.state.data, app.state.data.activeSpaceId, pendingSuggestions);
    root.MyTabDeskUtils.markDirty();
    await root.MyTabDeskUtils.saveData();
    closePreview();
    root.MyTabDeskRender.renderAll();
    root.MyTabDeskNotifications.showToast("AI 分组建议已应用", "success");
  }

  root.MyTabDeskAiGrouping = {
    loadConfig,
    saveConfig,
    requestSuggestions,
    buildInput,
    applyConfirmedSuggestions,
    loadConfigToForm,
    saveConfigFromForm,
    runGrouping,
    closePreview,
    confirmGrouping
  };
})(globalThis);
