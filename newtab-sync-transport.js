(function (root) {
/**
 * 创建同步传输适配器。
 *
 * 该模块只负责 WebDAV/Gist 协议交互，不读取页面状态或 DOM。
 * 网络重试、URL 校验与鉴权编码由调用方显式注入，便于独立测试。
 *
 * @param {object} dependencies 传输层依赖。
 * @returns {object} WebDAV/Gist 传输 API。
 */
function createSyncTransport(dependencies) {
  const {
    fetchWithTimeout,
    fetchWithRetry,
    resolveSafeWebDavFileUrl,
    createBasicAuthHeader,
    isMyTabDeskGist
  } = dependencies;

  /**
   * 上传备份文本到 WebDAV。
   *
   * @param {object} sync 同步配置。
   * @param {string} payload 待上传的备份文本。
   * @returns {Promise<void>} 上传完成后结束。
   */
  async function uploadWebDav(sync, payload) {
    const fileUrl = resolveSafeWebDavFileUrl(sync);
    const response = await fetchWithRetry(fileUrl, {
      method: "PUT",
      headers: {
        Authorization: createBasicAuthHeader(sync.webdavUsername, sync.webdavPassword),
        "Content-Type": "application/json;charset=utf-8"
      },
      body: payload
    });

    if (!response.ok) {
      throw new Error(`WebDAV 上传失败：${response.status}`);
    }
  }

  /**
   * 从 WebDAV 下载备份文本。
   *
   * @param {object} sync 同步配置。
   * @returns {Promise<string>} 下载得到的备份文本。
   */
  async function downloadWebDav(sync) {
    const fileUrl = resolveSafeWebDavFileUrl(sync);
    const response = await fetchWithRetry(fileUrl, {
      method: "GET",
      headers: {
        Authorization: createBasicAuthHeader(sync.webdavUsername, sync.webdavPassword)
      }
    });

    if (!response.ok) {
      throw new Error(`WebDAV 下载失败：${response.status}`);
    }

    return response.text();
  }

  /**
   * 从响应 Link 头中提取下一页地址。
   *
   * @param {Response} response fetch 响应。
   * @returns {string} 下一页地址，没有更多页时返回空字符串。
   */
  function getNextPageUrl(response) {
    const linkHeader = response.headers.get("Link") || "";
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match ? match[1] : "";
  }

  /**
   * 自动查找当前 Token 下已有的 MyTabDesk 同步 Gist。
   *
   * @param {object} sync 同步配置。
   * @returns {Promise<object|null>} 找到的 Gist 摘要对象，未找到时返回 null。
   */
  async function findMyTabDeskGist(sync) {
    const filename = sync.gistFilename || "mytabdesk-sync.json";
    let url = "https://api.github.com/gists?per_page=100";
    const maxPages = 10;

    for (let page = 0; page < maxPages && url; page += 1) {
      const response = await fetchWithRetry(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sync.gistToken}`,
          Accept: "application/vnd.github+json"
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub Gist 列表获取失败：${response.status}`);
      }

      const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
      if (rateLimitRemaining && parseInt(rateLimitRemaining, 10) < 5) {
        console.warn(`GitHub API 速率限制即将耗尽，剩余 ${rateLimitRemaining} 次请求`);
      }

      const gists = await response.json();
      for (const gist of gists) {
        if (isMyTabDeskGist(gist, filename)) {
          return gist;
        }
      }

      url = getNextPageUrl(response);
    }

    return null;
  }

  /**
   * 上传备份文本到 GitHub Gist，未填写 Gist ID 时自动查找或创建。
   *
   * @param {object} sync 同步配置。
   * @param {string} payload 待上传的备份文本。
   * @returns {Promise<string>} 上传后使用的 Gist ID。
   */
  async function uploadGist(sync, payload) {
    const filename = sync.gistFilename || "mytabdesk-sync.json";
    let gistId = sync.gistId;
    let isNewGist = false;

    if (!gistId) {
      const foundGist = await findMyTabDeskGist(sync);
      if (foundGist) {
        gistId = foundGist.id;
      } else {
        isNewGist = true;
      }
    }

    const url = isNewGist ? "https://api.github.com/gists" : `https://api.github.com/gists/${gistId}`;
    const request = {
      method: isNewGist ? "POST" : "PATCH",
      headers: {
        Authorization: `Bearer ${sync.gistToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json;charset=utf-8"
      },
      body: JSON.stringify({
        description: isNewGist ? "MyTabDesk Sync" : undefined,
        public: false,
        files: {
          [filename]: { content: payload }
        }
      })
    };
    // POST 创建 Gist 非幂等：服务端可能已创建但响应丢失，禁止通用自动重试。
    const response = isNewGist
      ? await fetchWithTimeout(url, request)
      : await fetchWithRetry(url, request);

    if (!response.ok) {
      throw new Error(`GitHub Gist 上传失败：${response.status}`);
    }

    const result = await response.json();
    return result.id || gistId;
  }

  /**
   * 从 GitHub Gist 下载备份文本。
   *
   * @param {object} sync 同步配置。
   * @returns {Promise<string>} 下载得到的备份文本。
   */
  async function downloadGist(sync) {
    let gistId = sync.gistId;

    if (!gistId) {
      const foundGist = await findMyTabDeskGist(sync);
      if (!foundGist) {
        throw new Error("未找到指定同步文件，请先上传一次自动创建 Gist。");
      }
      gistId = foundGist.id;
    }

    const response = await fetchWithRetry(`https://api.github.com/gists/${gistId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${sync.gistToken}`,
        Accept: "application/vnd.github+json"
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub Gist 下载失败：${response.status}`);
    }

    const result = await response.json();
    const filename = sync.gistFilename || "mytabdesk-sync.json";
    const file = result.files && result.files[filename] ? result.files[filename] : null;

    if (!file || typeof file.content !== "string") {
      throw new Error("Gist 中未找到指定同步文件。");
    }

    return file.content;
  }

  return {
    uploadWebDav,
    downloadWebDav,
    uploadGist,
    findMyTabDeskGist,
    downloadGist,
    getNextPageUrl
  };
}

root.MyTabDeskSyncTransport = {
  create: createSyncTransport
};
})(globalThis);
