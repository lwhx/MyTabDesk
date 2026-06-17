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
  state.appDialogActionHandler = null;
  elements.appDialog.hidden = true;

  if (resolver) {
    resolver(isPrompt ? promptValue : confirmed);
  }
}

/**
 * 触发弹窗的次要操作（如“重试”），先执行回调再关闭弹窗。
 *
 * @returns {void}
 */
function triggerAppDialogAction() {
  /** 次要操作回调。 */
  const handler = state.appDialogActionHandler;
  closeAppDialog(false);
  if (handler) {
    handler();
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
  /** 是否提供次要操作按钮（如“重试”）。 */
  const hasAction = Boolean(options.actionText);

  state.appDialogType = type;
  state.appDialogActionHandler = hasAction ? options.onAction : null;
  elements.appDialogTitle.textContent = options.title || "提示";
  elements.appDialogMessage.textContent = options.message || "";
  elements.appDialogInputWrap.hidden = type !== "prompt";
  elements.appDialogInput.value = options.defaultValue || "";
  elements.appDialogInput.setAttribute("aria-label", options.inputLabel || options.title || "输入内容");
  elements.appDialogCancelBtn.hidden = !needsCancel;
  elements.appDialogCancelBtn.textContent = options.cancelText || "取消";
  // 次要操作按钮（如“重试”）仅在提供 actionText 时显示
  elements.appDialogActionBtn.hidden = !hasAction;
  elements.appDialogActionBtn.textContent = options.actionText || "";
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
 * @param {object} [action] 可选的次要操作（如重试）。
 * @param {string} [action.actionText] 操作按钮文案。
 * @param {Function} [action.onAction] 点击操作时的回调。
 * @returns {Promise<boolean>} 用户确认后返回 true。
 */
function showAlert(message, title = "提示", action = null) {
  /** 弹窗配置。 */
  const options = {
    type: "alert",
    title,
    message,
    confirmText: "知道了"
  };

  if (action && action.actionText) {
    options.actionText = action.actionText;
    options.onAction = action.onAction;
  }

  return showAppDialog(options);
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
  triggerAppDialogAction,
  showAppDialog,
  showAlert,
  showConfirm,
  showPrompt
};
})(globalThis);
