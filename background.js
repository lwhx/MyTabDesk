/**
 * 监听插件图标点击事件，并在新标签页打开 MyTabDesk 主界面。
 */
chrome.action.onClicked.addListener(() => {
  /** MyTabDesk 主界面的插件内 URL。 */
  const pageUrl = chrome.runtime.getURL("newtab.html");

  chrome.tabs.create({ url: pageUrl });
});
