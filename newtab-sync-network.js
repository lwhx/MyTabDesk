(function (root) {
/**
 * 创建同步网络客户端。
 *
 * @param {object} options 可注入的网络与计时依赖。
 * @returns {object} 带超时和重试的网络 API。
 */
function createSyncNetwork(options = {}) {
  const fetchImpl = options.fetchImpl || root.fetch.bind(root);
  const timeoutMs = options.timeoutMs || 30000;
  const baseRetryDelay = options.baseRetryDelay === undefined ? 1000 : options.baseRetryDelay;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  /**
   * 判断 HTTP 状态码是否可安全重试。
   *
   * @param {number} status HTTP 状态码。
   * @returns {boolean} 可安全重试时返回 true。
   */
  function isRetryableStatus(status) {
    return status === 408 || status === 429 || (status >= 500 && status <= 504);
  }

  /**
   * 执行带超时控制的网络请求。
   *
   * @param {string} url 请求地址。
   * @param {object} requestOptions fetch 请求选项。
   * @returns {Promise<Response>} fetch 响应对象。
   */
  async function fetchWithTimeout(url, requestOptions) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetchImpl(url, { ...requestOptions, signal: controller.signal });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("远程同步请求超时，请检查网络连接", { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 对网络异常和 408/429/500-504 执行指数退避重试。
   *
   * @param {string} url 请求地址。
   * @param {object} requestOptions fetch 请求选项。
   * @param {number} maxRetries 最大重试次数。
   * @returns {Promise<Response>} 最终响应。
   */
  async function fetchWithRetry(url, requestOptions, maxRetries = 3) {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetchWithTimeout(url, requestOptions);

        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          const delay = baseRetryDelay * Math.pow(2, attempt);
          console.warn(`HTTP ${response.status}，${delay}ms 后重试 (${attempt + 1}/${maxRetries})`);
          await sleep(delay);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (error.name === "AbortError" || attempt >= maxRetries) {
          throw error;
        }

        const delay = baseRetryDelay * Math.pow(2, attempt);
        console.warn(`请求失败，${delay}ms 后重试 (${attempt + 1}/${maxRetries}):`, error.message);
        await sleep(delay);
      }
    }

    throw lastError;
  }

  return {
    isRetryableStatus,
    fetchWithTimeout,
    fetchWithRetry
  };
}

root.MyTabDeskSyncNetwork = {
  create: createSyncNetwork
};
})(globalThis);
