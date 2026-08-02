(function (root) {
  const app = root.MyTabDeskPage;
  const { state, elements } = app;
  const SVG_NS = "http://www.w3.org/2000/svg";
  let latestStats = { stats: { days: {}, spaces: {} }, timeStats: { days: {} }, lifecycle: { tabs: {} } };

  function getDayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDuration(ms) {
    const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60000));
    if (minutes < 60) return `${minutes} 分钟`;
    return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
  }

  function createSvgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    return element;
  }

  function renderTrendChart(days) {
    const svg = elements.statsTrendChart;
    svg.replaceChildren();
    const keys = [];
    const rangeDays = getTrendDays();
    for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - offset);
      keys.push(getDayKey(date));
    }
    const series = keys.map((key) => ({ key, ...(days[key] || {}) }));
    const maxValue = Math.max(1, ...series.flatMap((item) => [item.saveCount || 0, item.restoreCount || 0]));
    const left = 36;
    const top = 18;
    const width = 780;
    const height = 160;
    for (let row = 0; row <= 4; row += 1) {
      const y = top + height * row / 4;
      svg.appendChild(createSvgElement("line", { x1: left, y1: y, x2: left + width, y2: y, class: "stats-grid-line" }));
    }
    const makePoints = (field) => series.map((item, index) => {
      const x = left + width * index / Math.max(1, series.length - 1);
      const y = top + height - height * (item[field] || 0) / maxValue;
      return `${x},${y}`;
    }).join(" ");
    svg.appendChild(createSvgElement("polyline", { points: makePoints("saveCount"), class: "stats-line stats-line-save" }));
    svg.appendChild(createSvgElement("polyline", { points: makePoints("restoreCount"), class: "stats-line stats-line-restore" }));
    series.forEach((item, index) => {
      const labelStep = Math.max(1, Math.ceil(series.length / 8));
      if (index % labelStep !== 0 && index !== series.length - 1) return;
      const text = createSvgElement("text", { x: left + width * index / Math.max(1, series.length - 1), y: 205, class: "stats-axis-label", "text-anchor": "middle" });
      text.textContent = item.key.slice(5);
      svg.appendChild(text);
    });
  }

  function getTrendDays() {
    const value = Number(elements.statsTrendRangeSelect && elements.statsTrendRangeSelect.value);
    return [7, 14, 30, 90].includes(value) ? value : 30;
  }

  function renderDomainRanking(timeStats) {
    elements.statsDomainList.replaceChildren();
    const today = timeStats.days && timeStats.days[getDayKey()] || { domains: {} };
    const domains = Object.entries(today.domains || {}).sort((a, b) => b[1].activeMs - a[1].activeMs).slice(0, 10);
    elements.statsDomainsToday.textContent = String(domains.length);
    if (domains.length === 0) {
      elements.statsDomainList.textContent = "今天还没有网站停留记录。";
      return;
    }
    for (const [domain, values] of domains) {
      const row = document.createElement("div");
      row.className = "stats-ranking-row";
      const label = document.createElement("strong");
      label.textContent = domain;
      const value = document.createElement("span");
      value.textContent = formatDuration(values.activeMs);
      row.append(label, value);
      elements.statsDomainList.appendChild(row);
    }
  }

  function renderSpaceHealth() {
    elements.statsSpaceList.replaceChildren();
    const spaces = state.data.spaces.filter((space) => !space.deletedAt).map((space) => {
      const groups = space.groups.filter((group) => !group.deletedAt);
      const links = groups.flatMap((group) => group.links.filter((link) => !link.deletedAt));
      const checked = links.filter((link) => link.healthStatus);
      const healthy = checked.filter((link) => link.healthStatus === "ok");
      return { space, groups: groups.length, links: links.length, health: checked.length ? Math.round(healthy.length / checked.length * 100) : null };
    }).sort((a, b) => b.links - a.links);
    for (const item of spaces) {
      const row = document.createElement("div");
      row.className = "stats-ranking-row stats-space-row";
      const label = document.createElement("strong");
      label.textContent = item.space.name;
      const value = document.createElement("span");
      value.textContent = `${item.groups} 组 · ${item.links} 链接${item.health === null ? "" : ` · 存活率 ${item.health}%`}`;
      row.append(label, value);
      elements.statsSpaceList.appendChild(row);
    }
  }

  function renderStats() {
    const today = latestStats.stats.days[getDayKey()] || {};
    elements.statsSavedToday.textContent = String(today.savedLinks || 0);
    elements.statsRestoredToday.textContent = String(today.restoredLinks || 0);
    elements.statsTrackedTabs.textContent = String(Object.keys(latestStats.lifecycle.tabs || {}).length);
    renderTrendChart(latestStats.stats.days || {});
    renderDomainRanking(latestStats.timeStats || { days: {} });
    renderSpaceHealth();
  }

  async function loadStats() {
    latestStats = await chrome.runtime.sendMessage({ type: "get-usage-stats" });
    renderStats();
  }

  async function openStatsView() {
    state.viewMode = "stats";
    state.createSpaceMenuOpen = false;
    root.MyTabDeskRender.renderAll();
    await loadStats();
  }

  root.MyTabDeskStats = { openStatsView, loadStats, renderStats, renderTrendChart, getTrendDays };
})(globalThis);
