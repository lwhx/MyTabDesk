(function (root) {
  const { state } = root.MyTabDeskPage;
  const paletteState = { open: false, results: [], activeIndex: 0, previousFocus: null };

  function elements() {
    return {
      backdrop: document.getElementById("commandPalette"),
      input: document.getElementById("commandPaletteInput"),
      results: document.getElementById("commandPaletteResults")
    };
  }

  function buildResults(keyword) {
    const query = String(keyword || "").trim().toLowerCase();
    const results = [];
    for (const space of state.data.spaces || []) {
      if (space.deletedAt) continue;
      if (!query || space.name.toLowerCase().includes(query)) {
        results.push({ type: "space", title: space.name, subtitle: "空间", spaceId: space.id });
      }
      for (const group of space.groups || []) {
        if (group.deletedAt) continue;
        if (!query || group.name.toLowerCase().includes(query)) {
          results.push({
            type: "group", title: group.name, subtitle: `${space.name} / 分组`,
            spaceId: space.id, groupId: group.id
          });
        }
        for (const link of group.links || []) {
          if (link.deletedAt) continue;
          const haystack = `${link.title} ${link.url} ${link.note || ""}`.toLowerCase();
          if (!query || haystack.includes(query)) {
            results.push({
              type: "link", title: link.title, subtitle: `${space.name} / ${group.name}`,
              url: link.url, spaceId: space.id, groupId: group.id
            });
          }
        }
      }
    }
    for (const tab of state.currentTabs || []) {
      const haystack = `${tab.title || ""} ${tab.url || ""}`.toLowerCase();
      if (!query || haystack.includes(query)) {
        results.push({ type: "tab", title: tab.title || tab.url, subtitle: "当前窗口标签", tabId: tab.tabId });
      }
    }
    return results.slice(0, 60);
  }

  function renderResults() {
    const { results: container } = elements();
    container.replaceChildren();
    if (paletteState.results.length === 0) {
      elements().input.removeAttribute("aria-activedescendant");
      const empty = document.createElement("p");
      empty.className = "command-palette-empty";
      empty.textContent = "没有匹配结果";
      container.appendChild(empty);
      return;
    }
    paletteState.results.forEach((result, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "command-result";
      button.id = `command-result-${index}`;
      button.dataset.active = index === paletteState.activeIndex ? "true" : "false";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", index === paletteState.activeIndex ? "true" : "false");
      const title = document.createElement("strong");
      title.textContent = result.title;
      const subtitle = document.createElement("span");
      subtitle.textContent = result.subtitle;
      button.append(title, subtitle);
      button.addEventListener("mouseenter", () => {
        paletteState.activeIndex = index;
        renderResults();
      });
      button.addEventListener("click", () => safelyExecuteResult(result));
      container.appendChild(button);
    });
    elements().input.setAttribute("aria-activedescendant", `command-result-${paletteState.activeIndex}`);
  }

  function updateResults() {
    paletteState.results = buildResults(elements().input.value);
    paletteState.activeIndex = 0;
    renderResults();
  }

  function openPalette() {
    const ui = elements();
    paletteState.open = true;
    paletteState.previousFocus = document.activeElement;
    ui.backdrop.hidden = false;
    ui.input.value = "";
    updateResults();
    requestAnimationFrame(() => ui.input.focus());
  }

  function closePalette() {
    paletteState.open = false;
    elements().backdrop.hidden = true;
    if (paletteState.previousFocus && typeof paletteState.previousFocus.focus === "function") {
      paletteState.previousFocus.focus();
    }
    paletteState.previousFocus = null;
  }

  async function executeResult(result) {
    closePalette();
    if (result.type === "tab") {
      await root.MyTabDeskActions.activateTab(result.tabId);
      return;
    }
    if (result.type === "link") {
      await root.MyTabDeskActions.openLink(result.url);
      return;
    }
    state.data.activeSpaceId = result.spaceId;
    state.viewMode = "workspace";
    state.searchKeyword = "";
    root.MyTabDeskUtils.markDirty();
    await root.MyTabDeskUtils.saveData({ skipAutoSync: true });
    root.MyTabDeskRender.renderAll();
    if (result.type === "group") {
      requestAnimationFrame(() => {
        document.querySelector(`[data-group-id="${CSS.escape(result.groupId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }

  function safelyExecuteResult(result) {
    executeResult(result).catch((error) => {
      root.MyTabDeskNotifications.showToast(error.message || "无法执行该操作", "error");
    });
  }

  function handleKeydown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      paletteState.open ? closePalette() : openPalette();
      return;
    }
    if (!paletteState.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      paletteState.activeIndex = Math.min(paletteState.activeIndex + 1, paletteState.results.length - 1);
      renderResults();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      paletteState.activeIndex = Math.max(paletteState.activeIndex - 1, 0);
      renderResults();
    } else if (event.key === "Enter" && paletteState.results[paletteState.activeIndex]) {
      event.preventDefault();
      safelyExecuteResult(paletteState.results[paletteState.activeIndex]);
    }
  }

  function bindCommandPalette() {
    const ui = elements();
    ui.input.addEventListener("input", updateResults);
    ui.backdrop.addEventListener("click", (event) => {
      if (event.target === ui.backdrop) closePalette();
    });
    document.addEventListener("keydown", handleKeydown);
  }

  root.MyTabDeskCommandPalette = {
    bindCommandPalette,
    openPalette,
    closePalette,
    buildResults,
    state: paletteState
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
