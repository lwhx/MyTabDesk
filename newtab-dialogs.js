(function (root) {
const app = root.MyTabDeskPage;
const { state, elements } = app;

/**
 * 关闭页面通用弹窗并返回结果。
 *
 * @param {boolean} confirmed 用户是否确认。
 * @returns {void}
 */
function closeAppDialog(confirmed) {
  /** 当前通用弹窗关闭后的回调函数。 */
  const resolver = state.appDialogResolver;
  /** 当前弹窗是否为输入类型。 */
  const isPrompt = state.appDialogType === "prompt";
  /** 输入型弹窗的返回值。 */
  const promptValue = confirmed ? elements.appDialogInput.value : null;

  state.appDialogResolver = null;
  state.appDialogType = "alert";
  elements.appDialog.hidden = true;

  if (resolver) {
    resolver(isPrompt ? promptValue : confirmed);
  }
}

/**
 * 显示页面内统一弹窗。
 *
 * @param {object} options 弹窗配置。
 * @returns {Promise<boolean|string|null>} 弹窗关闭后的结果。
 */
function showAppDialog(options) {
  /** 弹窗类型。 */
  const type = options.type || "alert";
  /** 是否为确认或输入弹窗。 */
  const needsCancel = type === "confirm" || type === "prompt";

  state.appDialogType = type;
  elements.appDialogTitle.textContent = options.title || "提示";
  elements.appDialogMessage.textContent = options.message || "";
  elements.appDialogInputWrap.hidden = type !== "prompt";
  elements.appDialogInput.value = options.defaultValue || "";
  elements.appDialogInput.setAttribute("aria-label", options.inputLabel || options.title || "输入内容");
  elements.appDialogCancelBtn.hidden = !needsCancel;
  elements.appDialogCancelBtn.textContent = options.cancelText || "取消";
  elements.appDialogConfirmBtn.textContent = options.confirmText || "确认";
  elements.appDialog.hidden = false;

  return new Promise((resolve) => {
    state.appDialogResolver = resolve;
    requestAnimationFrame(() => {
      if (type === "prompt") {
        elements.appDialogInput.focus();
        elements.appDialogInput.select();
        return;
      }

      elements.appDialogConfirmBtn.focus();
    });
  });
}

/**
 * 显示页面内提示弹窗。
 *
 * @param {string} message 提示文本。
 * @param {string} title 弹窗标题。
 * @returns {Promise<boolean>} 用户确认后返回 true。
 */
function showAlert(message, title = "提示") {
  return showAppDialog({
    type: "alert",
    title,
    message,
    confirmText: "知道了"
  });
}

/**
 * 显示页面内确认弹窗。
 *
 * @param {string} message 确认文本。
 * @param {string} title 弹窗标题。
 * @returns {Promise<boolean>} 用户确认时返回 true，取消时返回 false。
 */
function showConfirm(message, title = "确认操作") {
  return showAppDialog({
    type: "confirm",
    title,
    message,
    confirmText: "确认",
    cancelText: "取消"
  });
}

/**
 * 显示页面内输入弹窗。
 *
 * @param {string} message 输入说明文本。
 * @param {string} defaultValue 默认输入值。
 * @param {string} title 弹窗标题。
 * @returns {Promise<string|null>} 用户输入文本，取消时返回 null。
 */
function showPrompt(message, defaultValue = "", title = "请输入") {
  return showAppDialog({
    type: "prompt",
    title,
    message,
    defaultValue,
    inputLabel: message,
    confirmText: "确认",
    cancelText: "取消"
  });
}

root.MyTabDeskDialogs = {
  closeAppDialog,
  showAppDialog,
  showAlert,
  showConfirm,
  showPrompt
};
})(globalThis);
