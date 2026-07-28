const fs = require("node:fs");
const path = require("node:path");
const nodeCrypto = require("node:crypto");

const projectRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(projectRoot, "dist", "MyTabDesk-Chrome");

const rootFiles = [
  "manifest.json",
  "background.js",
  "newtab.html",
  "newtab.css",
  "tabdesk-core.js",
  "types.js",
  "newtab-app.js",
  "newtab-utils.js",
  "newtab-dialogs.js",
  "newtab-sync-network.js",
  "newtab-sync-transport.js",
  "newtab-sync.js",
  "newtab-actions.js",
  "newtab-render.js",
  "newtab-notifications.js",
  "newtab-main.js"
];

const directoryFiles = [
  ...listFiles("core"),
  ...listFiles("assets")
];

const releaseFiles = [...rootFiles, ...directoryFiles].sort();

function listFiles(relativeDirectory) {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      return listFiles(relativePath);
    }
    return [relativePath];
  });
}

function hashFile(filePath) {
  return nodeCrypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listOutputFiles() {
  if (!fs.existsSync(outputRoot)) {
    return [];
  }

  function walk(directory, prefix = "") {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        return walk(path.join(directory, entry.name), relativePath);
      }
      return [relativePath];
    });
  }

  return walk(outputRoot).sort();
}

function buildDist() {
  fs.rmSync(outputRoot, { recursive: true, force: true });

  for (const relativePath of releaseFiles) {
    const source = path.join(projectRoot, relativePath);
    const destination = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }

  console.log(`发布目录已重建：${releaseFiles.length} 个文件`);
}

function checkDist() {
  const outputFiles = listOutputFiles();
  const expectedSet = new Set(releaseFiles);
  const outputSet = new Set(outputFiles);
  const missing = releaseFiles.filter((file) => !outputSet.has(file));
  const extra = outputFiles.filter((file) => !expectedSet.has(file));
  const changed = releaseFiles.filter((file) => {
    const output = path.join(outputRoot, file);
    return fs.existsSync(output) && hashFile(path.join(projectRoot, file)) !== hashFile(output);
  });

  if (missing.length || extra.length || changed.length) {
    if (missing.length) console.error("发布目录缺失：", missing);
    if (extra.length) console.error("发布目录多余：", extra);
    if (changed.length) console.error("发布目录陈旧：", changed);
    process.exitCode = 1;
    return;
  }

  console.log(`发布目录校验通过：${releaseFiles.length} 个文件`);
}

if (process.argv.includes("--check")) {
  checkDist();
} else {
  buildDist();
}
