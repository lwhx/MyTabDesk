/**
 * MyTabDesk 核心模块：MyTabDeskCoreCrypto
 * 由 tabdesk-core.js 拆分而来，保持 Node（require）与浏览器（全局命名空间）双环境兼容。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./constants.js"), require("./ids.js"), require("./normalize.js"), require("./io.js"), require("./sync-settings.js"));
  } else {
    root.MyTabDeskCoreCrypto = factory(root.MyTabDeskCoreConstants, root.MyTabDeskCoreIds, root.MyTabDeskCoreNormalize, root.MyTabDeskCoreIo, root.MyTabDeskCoreSyncSettings);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (constants, ids, normalize, io, syncSettings) {
  const { APP_VERSION, BACKUP_VERSION } = constants;
  const { getCurrentTime } = ids;
  const { createDefaultData, migrateData } = normalize;
  const { createBackupSafeData, extractBackupData } = io;
  const { getDataUpdatedAt } = syncSettings;
/**
 * 将字节数组转换为 Base64 文本。
 *
 * @param {Uint8Array} bytes 待编码的字节数组。
 * @returns {string} Base64 文本。
 */
function bytesToBase64(bytes) {
  /** 每个字节转换得到的字符数组。 */
  const chars = [];

  for (const byte of bytes) {
    chars.push(String.fromCharCode(byte));
  }

  return btoa(chars.join(""));
}

/**
 * 将 Base64 文本转换为字节数组。
 *
 * @param {string} text Base64 文本。
 * @returns {Uint8Array} 解码后的字节数组。
 */
function base64ToBytes(text) {
  /** Base64 解码后的二进制字符串。 */
  const binary = atob(text);
  /** 解码后的字节数组。 */
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * 使用 PBKDF2 从密码和盐值派生 AES-GCM 密钥。
 *
 * @param {string} password 用户输入的加密密码。
 * @param {Uint8Array} salt 随机盐值。
 * @param {number} iterations PBKDF2 迭代次数。
 * @returns {Promise<CryptoKey>} AES-GCM 加解密密钥。
 */
async function deriveAesKey(password, salt, iterations) {
  /** 密码原始密钥材料。 */
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 使用 AES-GCM 加密明文。
 *
 * @param {string} plaintext 明文 JSON 字符串。
 * @param {string} password 用户输入的加密密码。
 * @returns {Promise<object>} 加密参数和密文。
 */
async function aesGcmEncrypt(plaintext, password) {
  /** PBKDF2 迭代次数，遵循 OWASP 2023 推荐（≥600000）。解密端读取文件头里的 iterations，旧文件仍按其写入值解密，向后兼容。 */
  const iterations = 600000;
  /** 随机盐值。 */
  const salt = crypto.getRandomValues(new Uint8Array(16));
  /** AES-GCM 随机初始化向量。 */
  const iv = crypto.getRandomValues(new Uint8Array(12));
  /** AES-GCM 密钥。 */
  const key = await deriveAesKey(password, salt, iterations);
  /** 加密后的密文字节。 */
  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    algorithm: "PBKDF2-SHA256-AES-GCM",
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    payload: bytesToBase64(new Uint8Array(cipherBuffer))
  };
}

/**
 * 使用 AES-GCM 解密密文。
 *
 * @param {object} encryptedData 加密参数和密文。
 * @param {string} password 用户输入的解密密码。
 * @returns {Promise<string>} 解密后的明文 JSON 字符串。
 */
async function aesGcmDecrypt(encryptedData, password) {
  /** 随机盐值。 */
  const salt = base64ToBytes(encryptedData.salt);
  /** AES-GCM 初始化向量。 */
  const iv = base64ToBytes(encryptedData.iv);
  /** AES-GCM 密钥。 */
  const key = await deriveAesKey(password, salt, encryptedData.iterations);
  /** 密文字节。 */
  const cipherBytes = base64ToBytes(encryptedData.payload);
  /** 解密后的明文字节。 */
  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * 使用密码和 XOR 派生密钥对数据进行简单对称加密。
 *
 * 加密流程：
 * 1. 用 SHA-256 对密码哈希得到 32 字节密钥；
 * 2. 将密钥循环扩展到与明文等长；
 * 3. 逐字节 XOR 得到密文；
 * 4. Base64 编码存储。
 *
 * @param {string} plaintext 明文 JSON 字符串。
 * @param {string} password 用户输入的加密密码。
 * @returns {Promise<string>} Base64 编码的密文。
 */
async function xorEncrypt(plaintext, password) {
  /** 密码的 UTF-8 编码。 */
  const passwordBytes = new TextEncoder().encode(password);
  /** SHA-256 哈希后的 32 字节密钥。 */
  const keyBuffer = await crypto.subtle.digest("SHA-256", passwordBytes);
  /** 密钥数组，用于循环 XOR。 */
  const keyArray = new Uint8Array(keyBuffer);
  /** 明文的 UTF-8 编码。 */
  const plainBytes = new TextEncoder().encode(plaintext);
  /** 密文字节数组。 */
  const cipherBytes = new Uint8Array(plainBytes.length);

  for (let i = 0; i < plainBytes.length; i++) {
    cipherBytes[i] = plainBytes[i] ^ keyArray[i % keyArray.length];
  }

  /** 密文的 Base64 编码。 */
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < cipherBytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, cipherBytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * 使用密码和 XOR 派生密钥解密 Base64 密文。
 *
 * @param {string} cipherBase64 Base64 编码的密文。
 * @param {string} password 用户输入的解密密码。
 * @returns {Promise<string>} 解密后的明文 JSON 字符串。
 */
async function xorDecrypt(cipherBase64, password) {
  /** 密码的 UTF-8 编码。 */
  const passwordBytes = new TextEncoder().encode(password);
  /** SHA-256 哈希后的 32 字节密钥。 */
  const keyBuffer = await crypto.subtle.digest("SHA-256", passwordBytes);
  /** 密钥数组，用于循环 XOR。 */
  const keyArray = new Uint8Array(keyBuffer);
  /** Base64 解码后的密文字节数组。 */
  const cipherChars = atob(cipherBase64);
  /** 密文字节数组。 */
  const cipherBytes = new Uint8Array(cipherChars.length);

  for (let i = 0; i < cipherChars.length; i++) {
    cipherBytes[i] = cipherChars.charCodeAt(i);
  }

  /** 解密后的明文字节数组。 */
  const plainBytes = new Uint8Array(cipherBytes.length);

  for (let i = 0; i < cipherBytes.length; i++) {
    plainBytes[i] = cipherBytes[i] ^ keyArray[i % keyArray.length];
  }

  return new TextDecoder().decode(plainBytes);
}

/**
 * 创建加密备份文件内容。
 *
 * @param {object} data 当前全量数据。
 * @param {string} password 加密密码。
 * @param {string} deviceId 当前设备 ID。
 * @returns {Promise<string>} 加密备份 JSON 文本。
 * @throws {Error} 当密码为空时抛出错误。
 */
async function createEncryptedBackup(data, password, deviceId) {
  if (!password) {
    throw new Error("请输入加密密码");
  }

  /** 标准化并移除敏感同步凭据后的数据。 */
  const normalizedData = createBackupSafeData(data);
  /** 当前时间戳。 */
  const now = getCurrentTime();
  /** 当前设备 ID。 */
  const currentDeviceId = deviceId || normalizedData.settings.sync.deviceId || "";
  /** 加密前的备份包明文。 */
  const dataText = JSON.stringify({
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    deviceId: currentDeviceId,
    data: normalizedData
  });
  /** AES-GCM 加密结果。 */
  const encryptedData = await aesGcmEncrypt(dataText, password);

  return JSON.stringify({
    encrypted: true,
    backupVersion: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: now,
    deviceId: currentDeviceId,
    encryption: encryptedData.algorithm,
    iterations: encryptedData.iterations,
    salt: encryptedData.salt,
    iv: encryptedData.iv,
    payload: encryptedData.payload
  }, null, 2);
}

/**
 * 判断备份对象是否为旧版 XOR 加密备份。
 *
 * @param {object} backupData 解析后的备份对象。
 * @returns {boolean} 是旧版 XOR 加密备份时返回 true。
 */
function isLegacyXorEncryptedBackup(backupData) {
  if (!backupData || backupData.encryption || backupData.salt || backupData.iv || backupData.iterations) {
    return false;
  }

  return backupData.backupVersion === 1 && typeof backupData.payload === "string";
}

/**
 * 从加密备份文本恢复数据。
 *
 * @param {string} text 加密备份 JSON 文本。
 * @param {string} password 解密密码。
 * @returns {Promise<object>} 解密并标准化后的全量数据。
 * @throws {Error} 当密码错误或文件损坏时抛出错误。
 */
async function restoreEncryptedBackup(text, password) {
  if (!password) {
    throw new Error("请输入解密密码");
  }

  /** 解析后的备份对象。 */
  let backupData;

  try {
    backupData = JSON.parse(text);
  } catch (error) {
    throw new Error("密码错误或文件损坏", { cause: error });
  }

  if (!backupData || !backupData.payload) {
    throw new Error("密码错误或文件损坏");
  }

  /** 解密后的明文 JSON。 */
  let plainText;

  try {
    if (backupData.encryption === "PBKDF2-SHA256-AES-GCM") {
      plainText = await aesGcmDecrypt(backupData, password);
    } else if (isLegacyXorEncryptedBackup(backupData)) {
      plainText = await xorDecrypt(backupData.payload, password);
    } else {
      throw new Error("不支持的加密备份格式");
    }
  } catch (error) {
    throw new Error("密码错误或文件损坏", { cause: error });
  }

  /** 解密后的数据对象。 */
  let decryptedData;

  try {
    decryptedData = JSON.parse(plainText);
  } catch (error) {
    throw new Error("密码错误或文件损坏", { cause: error });
  }

  return migrateData(extractBackupData(decryptedData));
}

/**
 * 检测本地数据和待导入数据之间是否存在冲突。
 *
 * @param {object} localData 本地当前全量数据。
 * @param {object} importedData 待导入的全量数据。
 * @returns {object} 冲突检测结果，包含 isOlder、isDifferentDevice、requiresConfirm 字段。
 */
function detectImportConflict(localData, importedData) {
  /** 本地数据的最近更新时间。 */
  const localUpdatedAt = getDataUpdatedAt(localData);
  /** 待导入数据的最近更新时间。 */
  const importedUpdatedAt = getDataUpdatedAt(importedData);
  /** 导入数据是否比本地旧。 */
  const isOlder = importedUpdatedAt < localUpdatedAt;
  /** 本地设备 ID。 */
  const localDeviceId = localData.settings && localData.settings.sync ? localData.settings.sync.deviceId : "";
  /** 导入数据设备 ID。 */
  const importedDeviceId = importedData.settings && importedData.settings.sync ? importedData.settings.sync.deviceId : "";
  /** 是否来自不同设备。 */
  const isDifferentDevice = Boolean(localDeviceId && importedDeviceId && localDeviceId !== importedDeviceId);
  /** 是否需要二次确认。 */
  const requiresConfirm = isOlder || isDifferentDevice;

  return {
    isOlder,
    isDifferentDevice,
    requiresConfirm
  };
}

/**
 * 清空所有数据并恢复默认数据结构。
 *
 * @returns {object} 默认全量数据。
 */
function clearAllData() {
  return createDefaultData();
}

  return {
    bytesToBase64,
  base64ToBytes,
  deriveAesKey,
  aesGcmEncrypt,
  aesGcmDecrypt,
  /**
   * @deprecated 仅用于生成旧版 XOR 备份测试数据，新加密统一使用 AES-GCM。
   * 生产代码不应调用此函数。
   */
  xorEncrypt,
  xorDecrypt,
  createEncryptedBackup,
  isLegacyXorEncryptedBackup,
  restoreEncryptedBackup,
  detectImportConflict,
  clearAllData
  };
});
