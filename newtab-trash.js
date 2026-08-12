(function (root) {
  const app = root.MyTabDeskPage;
  const { state, elements } = app;
  const { getTrashItems, restoreTrashItem, purgeTrashItem, purgeExpiredTrash } = app;
  const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

  function getTypeLabel(type) {
    return ({ space: "空间", group: "分组", link: "链接" })[type] || "项目";
  }

  async function commitTrashChange(mutator, reason) {
    await app.stateController.commitWorkspaceChange(mutator, {
      reason,
      source: "trash",
      skipAutoSync: false
    });
  }

  function renderTrash() {
    if (!elements.trashList) return;
    elements.trashList.replaceChildren();
    const items = getTrashItems(state.data);
    elements.emptyTrashBtn.disabled = items.length === 0;
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "trash-empty-state";
      const title = document.createElement("strong");
      title.textContent = "回收站是空的";
      const text = document.createElement("span");
      text.textContent = "删除的空间、分组和链接会在这里保留 30 天。";
      empty.append(title, text);
      elements.trashList.appendChild(empty);
      return;
    }

    for (const item of items) {
      const row = document.createElement("article");
      row.className = "trash-item";
      row.dataset.trashType = item.type;
      const content = document.createElement("div");
      content.className = "trash-item-content";
      const heading = document.createElement("div");
      heading.className = "trash-item-heading";
      const badge = document.createElement("span");
      badge.className = `trash-type-badge type-${item.type}`;
      badge.textContent = getTypeLabel(item.type);
      const title = document.createElement("strong");
      title.textContent = item.title;
      heading.append(badge, title);
      const meta = document.createElement("span");
      meta.className = "trash-item-meta";
      const parent = item.parentTitle ? `${item.parentTitle} · ` : "";
      meta.textContent = `${parent}删除于 ${new Date(item.deletedAt).toLocaleString("zh-CN")}`;
      content.append(heading, meta);
      if (item.url) {
        const url = document.createElement("small");
        url.textContent = item.url;
        content.appendChild(url);
      }

      const actions = document.createElement("div");
      actions.className = "trash-item-actions";
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "secondary-button";
      restore.textContent = "恢复";
      restore.addEventListener("click", () => restoreItem(item));
      const purge = document.createElement("button");
      purge.type = "button";
      purge.className = "secondary-button danger-text-button";
      purge.textContent = "永久删除";
      purge.addEventListener("click", () => purgeItem(item));
      actions.append(restore, purge);
      row.append(content, actions);
      elements.trashList.appendChild(row);
    }
  }

  function openTrashView() {
    app.stateController.navigate("trash", { source: "trash" });
  }

  async function restoreItem(item) {
    await commitTrashChange((draft) => {
      draft.data = restoreTrashItem(draft.data, item);
    }, "trash-item-restored");
    root.MyTabDeskNotifications.showToast(`已恢复${getTypeLabel(item.type)}“${item.title}”`, "success");
  }

  async function purgeItem(item) {
    const confirmed = await root.MyTabDeskDialogs.showConfirm(
      `永久删除后无法恢复，确定删除${getTypeLabel(item.type)}“${item.title}”吗？`,
      "永久删除"
    );
    if (!confirmed) return;
    await commitTrashChange((draft) => {
      draft.data = purgeTrashItem(draft.data, item);
    }, "trash-item-purged");
  }

  async function emptyTrash() {
    const items = getTrashItems(state.data);
    if (items.length === 0) return;
    const confirmed = await root.MyTabDeskDialogs.showConfirm(
      `将永久删除回收站中的 ${items.length} 个项目，且无法恢复。是否继续？`,
      "清空回收站"
    );
    if (!confirmed) return;
    await commitTrashChange((draft) => {
      let nextData = draft.data;
      for (const item of items) nextData = purgeTrashItem(nextData, item);
      draft.data = nextData;
    }, "trash-emptied");
  }

  async function purgeExpiredItems() {
    const result = purgeExpiredTrash(state.data, RETENTION_MS);
    if (result.purgedCount === 0) return;
    await commitTrashChange((draft) => {
      draft.data = result.data;
    }, "trash-expired-purged");
  }

  root.MyTabDeskTrash = {
    openTrashView,
    renderTrash,
    restoreItem,
    purgeItem,
    emptyTrash,
    purgeExpiredItems
  };
})(globalThis);
