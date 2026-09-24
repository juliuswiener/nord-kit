"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/tools/lsp/hook-entry.ts
var hook_entry_exports = {};
__export(hook_entry_exports, {
  commandExists: () => commandExists,
  disconnectAll: () => disconnectAll,
  editDiagnostics: () => editDiagnostics,
  getServerForFile: () => getServerForFile,
  requestEditDiagnostics: () => requestEditDiagnostics,
  startDiagSocket: () => startDiagSocket
});
module.exports = __toCommonJS(hook_entry_exports);

// src/tools/lsp/servers.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_path = require("path");
var TYPESCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];
var TYPESCRIPT_CLASSIC_SERVER = {
  name: "TypeScript Language Server",
  command: "typescript-language-server",
  args: ["--stdio"],
  extensions: TYPESCRIPT_EXTENSIONS,
  installHint: "npm install -g typescript-language-server typescript"
};
function getTypeScriptNativeBin(packageRoot) {
  const packageNodeModules = (0, import_path.dirname)(packageRoot);
  const workspaceRoot = (0, import_path.dirname)(packageNodeModules);
  const executable = process.platform === "win32" ? "tsc.cmd" : "tsc";
  return (0, import_path.join)(workspaceRoot, "node_modules", ".bin", executable);
}
function findTypeScriptPackageRoot(workspaceRoot) {
  let dir = (0, import_path.resolve)(workspaceRoot);
  while (true) {
    const packageJsonPath = (0, import_path.join)(dir, "node_modules", "typescript", "package.json");
    if ((0, import_fs.existsSync)(packageJsonPath)) {
      return (0, import_path.dirname)(packageJsonPath);
    }
    const parsed = (0, import_path.parse)(dir);
    if (parsed.root === dir) {
      return null;
    }
    dir = (0, import_path.dirname)(dir);
  }
}
function readTypeScriptMajorVersion(packageRoot) {
  try {
    const packageJson = JSON.parse((0, import_fs.readFileSync)((0, import_path.join)(packageRoot, "package.json"), "utf8"));
    if (typeof packageJson.version !== "string") {
      return null;
    }
    const major = Number.parseInt(packageJson.version.split(".")[0] ?? "", 10);
    return Number.isNaN(major) ? null : major;
  } catch {
    return null;
  }
}
function shouldUseNativeTypeScriptServer(packageRoot) {
  const majorVersion = readTypeScriptMajorVersion(packageRoot);
  if (majorVersion !== null && majorVersion >= 7) {
    return true;
  }
  if ((0, import_fs.existsSync)((0, import_path.join)(packageRoot, "lib", "getExePath.js"))) {
    return true;
  }
  return !(0, import_fs.existsSync)((0, import_path.join)(packageRoot, "lib", "tsserver.js"));
}
function findGlobalNativeTsc() {
  const executable = process.platform === "win32" ? "tsc.cmd" : "tsc";
  for (const dir of (process.env.PATH ?? "").split(import_path.delimiter)) {
    if (!dir) continue;
    const bin = (0, import_path.join)(dir, executable);
    if (!(0, import_fs.existsSync)(bin)) continue;
    try {
      const packageRoot = (0, import_path.dirname)((0, import_path.dirname)((0, import_fs.realpathSync)(bin)));
      if (!(0, import_fs.existsSync)((0, import_path.join)(packageRoot, "package.json"))) return null;
      return shouldUseNativeTypeScriptServer(packageRoot) ? bin : null;
    } catch {
      return null;
    }
  }
  return null;
}
function nativeTypeScriptServer(command) {
  return {
    name: "TypeScript 7 Native Language Server (typescript-go)",
    command,
    args: ["--lsp", "--stdio"],
    extensions: TYPESCRIPT_EXTENSIONS,
    installHint: "Install TypeScript 7 locally so node_modules/.bin/tsc is available"
  };
}
function getTypeScriptServerForWorkspace(workspaceRoot) {
  const packageRoot = findTypeScriptPackageRoot(workspaceRoot);
  if (packageRoot && shouldUseNativeTypeScriptServer(packageRoot)) {
    const localTsc = getTypeScriptNativeBin(packageRoot);
    if ((0, import_fs.existsSync)(localTsc)) {
      return nativeTypeScriptServer(localTsc);
    }
  }
  const globalTsc = findGlobalNativeTsc();
  return globalTsc ? nativeTypeScriptServer(globalTsc) : TYPESCRIPT_CLASSIC_SERVER;
}
var LSP_SERVERS = {
  typescript: TYPESCRIPT_CLASSIC_SERVER,
  python: {
    name: "Python Language Server (ty)",
    command: "ty",
    args: ["server"],
    extensions: [".py", ".pyw"],
    installHint: "Install ty from https://github.com/astral-sh/ty"
  },
  rust: {
    name: "Rust Analyzer",
    command: "rust-analyzer",
    args: [],
    extensions: [".rs"],
    installHint: "rustup component add rust-analyzer"
  },
  go: {
    name: "gopls",
    command: "gopls",
    args: ["serve"],
    extensions: [".go"],
    installHint: "go install golang.org/x/tools/gopls@latest"
  },
  c: {
    name: "clangd",
    command: "clangd",
    args: [],
    extensions: [".c", ".h", ".cpp", ".cc", ".cxx", ".hpp", ".hxx"],
    installHint: "Install clangd from your package manager or LLVM"
  },
  java: {
    name: "Eclipse JDT Language Server",
    command: "jdtls",
    args: [],
    extensions: [".java"],
    installHint: "Install from https://github.com/eclipse/eclipse.jdt.ls"
  },
  json: {
    name: "JSON Language Server",
    command: "vscode-json-language-server",
    args: ["--stdio"],
    extensions: [".json", ".jsonc"],
    installHint: "npm install -g vscode-langservers-extracted"
  },
  html: {
    name: "HTML Language Server",
    command: "vscode-html-language-server",
    args: ["--stdio"],
    extensions: [".html", ".htm"],
    installHint: "npm install -g vscode-langservers-extracted"
  },
  css: {
    name: "CSS Language Server",
    command: "vscode-css-language-server",
    args: ["--stdio"],
    extensions: [".css", ".scss", ".less"],
    installHint: "npm install -g vscode-langservers-extracted"
  },
  vue: {
    name: "Vue Language Server (Volar)",
    command: "vue-language-server",
    args: ["--stdio"],
    extensions: [".vue"],
    installHint: "npm install -g @vue/language-server"
  },
  toml: {
    name: "Taplo (TOML)",
    command: "taplo",
    args: ["lsp", "stdio"],
    extensions: [".toml"],
    installHint: "cargo install taplo-cli --locked, or your package manager"
  },
  yaml: {
    name: "YAML Language Server",
    command: "yaml-language-server",
    args: ["--stdio"],
    extensions: [".yaml", ".yml"],
    installHint: "npm install -g yaml-language-server"
  },
  php: {
    name: "PHP Language Server (Intelephense)",
    command: "intelephense",
    args: ["--stdio"],
    extensions: [".php", ".phtml"],
    installHint: "npm install -g intelephense"
  },
  ruby: {
    name: "Ruby Language Server (Solargraph)",
    command: "solargraph",
    args: ["stdio"],
    extensions: [".rb", ".rake", ".gemspec", ".erb"],
    installHint: "gem install solargraph"
  },
  lua: {
    name: "Lua Language Server",
    command: "lua-language-server",
    args: [],
    extensions: [".lua"],
    installHint: "Install from https://github.com/LuaLS/lua-language-server"
  },
  kotlin: {
    name: "Kotlin Language Server",
    command: "kotlin-lsp",
    args: ["--stdio"],
    extensions: [".kt", ".kts"],
    installHint: "Install from https://github.com/Kotlin/kotlin-lsp (brew install JetBrains/utils/kotlin-lsp)",
    initializeTimeoutMs: 5 * 60 * 1e3
  },
  elixir: {
    name: "ElixirLS",
    command: "elixir-ls",
    args: [],
    extensions: [".ex", ".exs", ".heex", ".eex"],
    installHint: "Install from https://github.com/elixir-lsp/elixir-ls"
  },
  csharp: {
    name: "OmniSharp",
    command: "omnisharp",
    args: ["-lsp"],
    extensions: [".cs"],
    installHint: "dotnet tool install -g omnisharp"
  },
  dart: {
    name: "Dart Analysis Server",
    command: "dart",
    args: ["language-server", "--protocol=lsp"],
    extensions: [".dart"],
    installHint: "Install Dart SDK from https://dart.dev/get-dart or Flutter SDK from https://flutter.dev"
  },
  swift: {
    name: "SourceKit-LSP",
    command: "sourcekit-lsp",
    args: [],
    extensions: [".swift"],
    installHint: "Install Swift from https://swift.org/download or via Xcode"
  },
  verilog: {
    name: "Verible Verilog Language Server",
    command: "verible-verilog-ls",
    args: ["--rules_config_search"],
    extensions: [".v", ".vh", ".sv", ".svh"],
    installHint: "Download from https://github.com/chipsalliance/verible/releases"
  }
};
function commandExists(command) {
  if ((0, import_path.isAbsolute)(command)) return (0, import_fs.existsSync)(command);
  const checkCommand = process.platform === "win32" ? "where" : "which";
  const result = (0, import_child_process.spawnSync)(checkCommand, [command], { stdio: "ignore" });
  return result.status === 0;
}
function getServerForFile(filePath, workspaceRoot) {
  const ext = (0, import_path.extname)(filePath).toLowerCase();
  if (TYPESCRIPT_EXTENSIONS.includes(ext) && workspaceRoot) {
    return getTypeScriptServerForWorkspace(workspaceRoot);
  }
  for (const [_, config] of Object.entries(LSP_SERVERS)) {
    if (config.extensions.includes(ext)) {
      return config;
    }
  }
  return null;
}

// src/tools/lsp/client.ts
var import_child_process3 = require("child_process");
var import_fs3 = require("fs");
var import_path4 = require("path");
var import_url2 = require("url");

// src/tools/lsp/devcontainer.ts
var import_child_process2 = require("child_process");
var import_fs2 = require("fs");
var import_path2 = require("path");
var import_path3 = require("path");
var import_url = require("url");

// src/utils/jsonc.ts
function parseJsonc(content) {
  const cleaned = stripJsoncComments(content);
  return JSON.parse(cleaned);
}
function stripJsoncComments(content) {
  return stripTrailingCommas(stripComments(content));
}
function stripComments(content) {
  let result = "";
  let i = 0;
  while (i < content.length) {
    if (content[i] === "/" && content[i + 1] === "/") {
      while (i < content.length && content[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (content[i] === "/" && content[i + 1] === "*") {
      i += 2;
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }
    if (content[i] === '"') {
      result += content[i];
      i++;
      while (i < content.length && content[i] !== '"') {
        if (content[i] === "\\") {
          result += content[i];
          i++;
          if (i < content.length) {
            result += content[i];
            i++;
          }
          continue;
        }
        result += content[i];
        i++;
      }
      if (i < content.length) {
        result += content[i];
        i++;
      }
      continue;
    }
    result += content[i];
    i++;
  }
  return result;
}
function stripTrailingCommas(content) {
  let result = "";
  let i = 0;
  while (i < content.length) {
    if (content[i] === '"') {
      result += content[i];
      i++;
      while (i < content.length && content[i] !== '"') {
        if (content[i] === "\\") {
          result += content[i];
          i++;
          if (i < content.length) {
            result += content[i];
            i++;
          }
          continue;
        }
        result += content[i];
        i++;
      }
      if (i < content.length) {
        result += content[i];
        i++;
      }
      continue;
    }
    if (content[i] === ",") {
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) {
        j++;
      }
      if (content[j] === "}" || content[j] === "]") {
        i++;
        continue;
      }
    }
    result += content[i];
    i++;
  }
  return result;
}

// src/tools/lsp/devcontainer.ts
var DEVCONTAINER_PRIMARY_CONFIG_PATH = [".devcontainer", "devcontainer.json"];
var DEVCONTAINER_DOTFILE_NAME = ".devcontainer.json";
var DEVCONTAINER_CONFIG_DIR = ".devcontainer";
var DEVCONTAINER_LOCAL_FOLDER_LABELS = [
  "devcontainer.local_folder",
  "vsch.local.folder"
];
var DEVCONTAINER_CONFIG_FILE_LABELS = [
  "devcontainer.config_file",
  "vsch.config.file"
];
function resolveDevContainerContext(workspaceRoot) {
  const hostWorkspaceRoot = (0, import_path2.resolve)(workspaceRoot);
  const configFilePath = resolveDevContainerConfigPath(hostWorkspaceRoot);
  const config = readDevContainerConfig(configFilePath);
  const overrideContainerId = process.env.NORD_LSP_CONTAINER_ID?.trim();
  if (overrideContainerId) {
    return buildContextFromContainer(overrideContainerId, hostWorkspaceRoot, configFilePath, config);
  }
  const containerIds = listRunningContainerIds();
  if (containerIds.length === 0) {
    return null;
  }
  let bestMatch = null;
  for (const containerId of containerIds) {
    const inspect = inspectContainer(containerId);
    if (!inspect) {
      continue;
    }
    const score = scoreContainerMatch(inspect, hostWorkspaceRoot, configFilePath);
    if (score <= 0) {
      continue;
    }
    const context = buildContextFromInspect(inspect, hostWorkspaceRoot, configFilePath, config);
    if (!context) {
      continue;
    }
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { score, context };
    }
  }
  return bestMatch?.context ?? null;
}
function hostPathToContainerPath(filePath, context) {
  if (!context) {
    return (0, import_path2.resolve)(filePath);
  }
  const resolvedPath = (0, import_path2.resolve)(filePath);
  const relativePath = (0, import_path2.relative)(context.hostWorkspaceRoot, resolvedPath);
  if (relativePath === "") {
    return context.containerWorkspaceRoot;
  }
  if (relativePath.startsWith("..") || relativePath.includes(`..${import_path2.sep}`)) {
    return resolvedPath;
  }
  const posixRelativePath = relativePath.split(import_path2.sep).join("/");
  return import_path3.posix.join(context.containerWorkspaceRoot, posixRelativePath);
}
function containerPathToHostPath(filePath, context) {
  if (!context) {
    return (0, import_path2.resolve)(filePath);
  }
  const normalizedContainerPath = normalizeContainerPath(filePath);
  const relativePath = import_path3.posix.relative(context.containerWorkspaceRoot, normalizedContainerPath);
  if (relativePath === "") {
    return context.hostWorkspaceRoot;
  }
  if (relativePath.startsWith("..") || relativePath.includes("../")) {
    return normalizedContainerPath;
  }
  return (0, import_path2.resolve)(context.hostWorkspaceRoot, ...relativePath.split("/"));
}
function hostUriToContainerUri(uri, context) {
  if (!context || !uri.startsWith("file://")) {
    return uri;
  }
  return containerPathToFileUri(hostPathToContainerPath((0, import_url.fileURLToPath)(uri), context));
}
function containerUriToHostUri(uri, context) {
  if (!context || !uri.startsWith("file://")) {
    return uri;
  }
  return (0, import_url.pathToFileURL)(containerPathToHostPath((0, import_url.fileURLToPath)(uri), context)).href;
}
function resolveDevContainerConfigPath(workspaceRoot) {
  let dir = workspaceRoot;
  while (true) {
    const configFilePath = resolveDevContainerConfigPathAt(dir);
    if (configFilePath) {
      return configFilePath;
    }
    const parsed = (0, import_path2.parse)(dir);
    if (parsed.root === dir) {
      return void 0;
    }
    dir = (0, import_path2.dirname)(dir);
  }
}
function resolveDevContainerConfigPathAt(dir) {
  const primaryConfigPath = (0, import_path2.join)(dir, ...DEVCONTAINER_PRIMARY_CONFIG_PATH);
  if ((0, import_fs2.existsSync)(primaryConfigPath)) {
    return primaryConfigPath;
  }
  const dotfileConfigPath = (0, import_path2.join)(dir, DEVCONTAINER_DOTFILE_NAME);
  if ((0, import_fs2.existsSync)(dotfileConfigPath)) {
    return dotfileConfigPath;
  }
  const devcontainerDir = (0, import_path2.join)(dir, DEVCONTAINER_CONFIG_DIR);
  if (!(0, import_fs2.existsSync)(devcontainerDir)) {
    return void 0;
  }
  const nestedConfigPaths = (0, import_fs2.readdirSync)(devcontainerDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => (0, import_path2.join)(devcontainerDir, entry.name, "devcontainer.json")).filter(import_fs2.existsSync).sort((left, right) => left.localeCompare(right));
  return nestedConfigPaths[0];
}
function deriveHostDevContainerRoot(configFilePath) {
  const resolvedConfigPath = (0, import_path2.resolve)(configFilePath);
  if ((0, import_path2.basename)(resolvedConfigPath) === DEVCONTAINER_DOTFILE_NAME) {
    return (0, import_path2.dirname)(resolvedConfigPath);
  }
  const configParentDir = (0, import_path2.dirname)(resolvedConfigPath);
  if ((0, import_path2.basename)(configParentDir) === DEVCONTAINER_CONFIG_DIR) {
    return (0, import_path2.dirname)(configParentDir);
  }
  const configGrandparentDir = (0, import_path2.dirname)(configParentDir);
  if ((0, import_path2.basename)(configGrandparentDir) === DEVCONTAINER_CONFIG_DIR) {
    return (0, import_path2.dirname)(configGrandparentDir);
  }
  return (0, import_path2.dirname)(configParentDir);
}
function readDevContainerConfig(configFilePath) {
  if (!configFilePath || !(0, import_fs2.existsSync)(configFilePath)) {
    return null;
  }
  try {
    const parsed = parseJsonc((0, import_fs2.readFileSync)(configFilePath, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}
function listRunningContainerIds() {
  const result = runDocker(["ps", "-q"]);
  if (!result || result.status !== 0) {
    return [];
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function inspectContainer(containerId) {
  const result = runDocker(["inspect", containerId]);
  if (!result || result.status !== 0) {
    return null;
  }
  try {
    const stdout = typeof result.stdout === "string" ? result.stdout : result.stdout.toString("utf8");
    const parsed = JSON.parse(stdout);
    const inspect = parsed[0];
    if (!inspect?.Id || inspect.State?.Running === false) {
      return null;
    }
    return inspect;
  } catch {
    return null;
  }
}
function buildContextFromContainer(containerId, hostWorkspaceRoot, configFilePath, config) {
  const inspect = inspectContainer(containerId);
  if (!inspect) {
    return null;
  }
  return buildContextFromInspect(inspect, hostWorkspaceRoot, configFilePath, config);
}
function buildContextFromInspect(inspect, hostWorkspaceRoot, configFilePath, config) {
  const containerWorkspaceRoot = deriveContainerWorkspaceRoot(inspect, hostWorkspaceRoot, config?.workspaceFolder);
  if (!containerWorkspaceRoot || !inspect.Id) {
    return null;
  }
  return {
    containerId: inspect.Id,
    hostWorkspaceRoot,
    containerWorkspaceRoot,
    configFilePath
  };
}
function deriveContainerWorkspaceRoot(inspect, hostWorkspaceRoot, workspaceFolder) {
  const mounts = Array.isArray(inspect.Mounts) ? inspect.Mounts : [];
  let bestMountMatch = null;
  for (const mount of mounts) {
    const source = mount.Source ? (0, import_path2.resolve)(mount.Source) : "";
    const destination = mount.Destination ? normalizeContainerPath(mount.Destination) : "";
    if (!source || !destination) {
      continue;
    }
    if (source === hostWorkspaceRoot) {
      return destination;
    }
    const relativePath = (0, import_path2.relative)(source, hostWorkspaceRoot);
    if (relativePath === "" || relativePath.startsWith("..") || relativePath.includes(`..${import_path2.sep}`)) {
      continue;
    }
    if (!bestMountMatch || source.length > bestMountMatch.sourceLength) {
      bestMountMatch = {
        sourceLength: source.length,
        destination: import_path3.posix.join(destination, relativePath.split(import_path2.sep).join("/"))
      };
    }
  }
  if (bestMountMatch) {
    return bestMountMatch.destination;
  }
  return workspaceFolder ? normalizeContainerPath(workspaceFolder) : null;
}
function scoreContainerMatch(inspect, hostWorkspaceRoot, configFilePath) {
  const labels = inspect.Config?.Labels ?? {};
  let score = 0;
  let hasDevContainerLabelMatch = false;
  const expectedLocalFolder = configFilePath ? deriveHostDevContainerRoot(configFilePath) : (0, import_path2.resolve)(hostWorkspaceRoot);
  for (const label of DEVCONTAINER_LOCAL_FOLDER_LABELS) {
    if (labels[label] && (0, import_path2.resolve)(labels[label]) === expectedLocalFolder) {
      score += 4;
      hasDevContainerLabelMatch = true;
    }
  }
  if (configFilePath) {
    for (const label of DEVCONTAINER_CONFIG_FILE_LABELS) {
      if (labels[label] && (0, import_path2.resolve)(labels[label]) === configFilePath) {
        score += 3;
        hasDevContainerLabelMatch = true;
      }
    }
  }
  const mappedWorkspaceRoot = deriveContainerWorkspaceRoot(inspect, hostWorkspaceRoot);
  if (mappedWorkspaceRoot && (Boolean(configFilePath) || hasDevContainerLabelMatch)) {
    score += 1;
  }
  return score;
}
function normalizeContainerPath(filePath) {
  return import_path3.posix.normalize(filePath.replace(/\\/g, "/"));
}
function containerPathToFileUri(filePath) {
  const normalizedPath = normalizeContainerPath(filePath);
  const encodedPath = normalizedPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `file://${encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`}`;
}
function runDocker(args) {
  const result = (0, import_child_process2.spawnSync)("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.error) {
    return null;
  }
  return result;
}

// src/tools/lsp/client.ts
var DEFAULT_LSP_REQUEST_TIMEOUT_MS = (() => {
  return readPositiveIntEnv("NORD_LSP_TIMEOUT_MS", 15e3);
})();
var LSP_CONTENT_MODIFIED = -32801;
var LSP_SERVER_CANCELLED = -32802;
var LSP_METHOD_NOT_FOUND = -32601;
var DIAGNOSTICS_SETTLE_MS = readPositiveIntEnv("NORD_LSP_DIAGNOSTICS_SETTLE_MS", 150);
var CONTENT_MODIFIED_MAX_ATTEMPTS = 3;
var CONTENT_MODIFIED_BACKOFF_MS = [50, 150];
var RETRYABLE_LSP_CODES = /* @__PURE__ */ new Set([LSP_CONTENT_MODIFIED, LSP_SERVER_CANCELLED]);
var INDEX_READY_RETRY_BUDGET_MS = readPositiveIntEnv("NORD_LSP_INDEX_RETRY_BUDGET_MS", 5e3);
var INDEX_COLD_WINDOW_MS = readPositiveIntEnv("NORD_LSP_COLD_WINDOW_MS", 5e3);
var LspResponseError = class extends Error {
  code;
  data;
  constructor(code, message, data) {
    super(message);
    this.name = "LspResponseError";
    this.code = code;
    this.data = data;
  }
};
var INDEX_DEPENDENT_METHODS = /* @__PURE__ */ new Set([
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/prepareCallHierarchy",
  "callHierarchy/incomingCalls",
  "callHierarchy/outgoingCalls",
  "workspace/symbol"
]);
function sleep(ms) {
  return new Promise((resolve4) => setTimeout(resolve4, ms));
}
function isEmptyLspResult(value) {
  if (value === null || value === void 0) return true;
  return Array.isArray(value) && value.length === 0;
}
function getLspRequestTimeout(serverConfig, method, baseTimeout = DEFAULT_LSP_REQUEST_TIMEOUT_MS) {
  if (method === "initialize" && serverConfig.initializeTimeoutMs) {
    return Math.max(baseTimeout, serverConfig.initializeTimeoutMs);
  }
  return baseTimeout;
}
function readPositiveIntEnv(name, fallback) {
  const env = process.env[name];
  if (!env) {
    return fallback;
  }
  const parsed = parseInt(env, 10);
  return !isNaN(parsed) && parsed > 0 ? parsed : fallback;
}
function fileUri(filePath) {
  return (0, import_url2.pathToFileURL)((0, import_path4.resolve)(filePath)).href;
}
var LspClient = class _LspClient {
  static MAX_BUFFER_SIZE = 50 * 1024 * 1024;
  // 50MB
  process = null;
  requestId = 0;
  pendingRequests = /* @__PURE__ */ new Map();
  buffer = Buffer.alloc(0);
  openDocuments = /* @__PURE__ */ new Set();
  diagnostics = /* @__PURE__ */ new Map();
  diagnosticWaiters = /* @__PURE__ */ new Map();
  /** When the newest publishDiagnostics for a URI arrived. Basis for the settle window. */
  diagnosticsUpdatedAt = /* @__PURE__ */ new Map();
  /**
   * How many publishDiagnostics have arrived for a URI.
   *
   * A counter, not a timestamp: Date.now() has millisecond granularity and the
   * publish answering a didChange routinely lands in the SAME millisecond the
   * change was sent, so "newer than sentAt" was false for an answer that had
   * already arrived. Measured cost of that off-by-one-millisecond: a TOML edit
   * that should take ~600ms sat for the full 4s budget and then returned the
   * right answer anyway.
   */
  diagnosticsSeq = /* @__PURE__ */ new Map();
  /** Latest didChange version per open document, for full-text replacements. */
  documentVersions = /* @__PURE__ */ new Map();
  /** URIs the server has actually answered about. See diagnosticsAnswered(). */
  diagnosticsAnsweredFor = /* @__PURE__ */ new Set();
  workspaceRoot;
  serverConfig;
  devContainerContext;
  initialized = false;
  _serverCapabilities = null;
  _supportsPullDiagnostics = false;
  /** Set once a server that advertised pull diagnostics has refused the request. */
  pullDiagnosticsRefused = false;
  /** When `initialize` completed. Basis for the cold window when a server offers no readiness signal. */
  connectedAt = 0;
  /** Whether this server has ever sent a readiness notification we understand. */
  sawReadinessSignal = false;
  /** Latest readiness the server reported. Only meaningful once sawReadinessSignal is true. */
  serverQuiescent = false;
  constructor(workspaceRoot, serverConfig, devContainerContext = null) {
    this.workspaceRoot = (0, import_path4.resolve)(workspaceRoot);
    this.serverConfig = serverConfig;
    this.devContainerContext = devContainerContext;
  }
  /**
   * Start the LSP server and initialize the connection
   */
  async connect() {
    if (this.process) {
      return;
    }
    const spawnCommand = this.devContainerContext ? "docker" : this.serverConfig.command;
    if (!commandExists(spawnCommand)) {
      throw new Error(
        this.devContainerContext ? `Docker CLI not found. Required to start '${this.serverConfig.command}' inside container ${this.devContainerContext.containerId}.` : `Language server '${this.serverConfig.command}' not found.
Install with: ${this.serverConfig.installHint}`
      );
    }
    return new Promise((resolve4, reject) => {
      const command = this.devContainerContext ? "docker" : this.serverConfig.command;
      const args = this.devContainerContext ? ["exec", "-i", "-w", this.devContainerContext.containerWorkspaceRoot, this.devContainerContext.containerId, this.serverConfig.command, ...this.serverConfig.args] : this.serverConfig.args;
      this.process = (0, import_child_process3.spawn)(command, args, {
        cwd: this.workspaceRoot,
        stdio: ["pipe", "pipe", "pipe"],
        shell: !this.devContainerContext && process.platform === "win32"
      });
      this.process.stdout?.on("data", (data) => {
        this.handleData(data);
      });
      this.process.stderr?.on("data", (data) => {
        console.error(`LSP stderr: ${data.toString()}`);
      });
      this.process.on("error", (error) => {
        reject(new Error(`Failed to start LSP server: ${error.message}`));
      });
      this.process.on("exit", (code) => {
        this.process = null;
        this.initialized = false;
        if (code !== 0) {
          console.error(`LSP server exited with code ${code}`);
        }
        this.rejectPendingRequests(new Error(`LSP server exited (code ${code})`));
      });
      this.initialize().then(() => {
        this.initialized = true;
        this.connectedAt = Date.now();
        resolve4();
      }).catch(reject);
    });
  }
  /**
   * Pid of the language server this client owns, if it is running.
   *
   * Exposed so the daemon can report which processes it is responsible for, and
   * so a leak probe can count language servers by ownership rather than by
   * pattern-matching a process list.
   */
  get serverPid() {
    return this.process?.pid;
  }
  /**
   * Synchronously kill the LSP server process.
   * Used in process exit handlers where async operations are not possible.
   */
  forceKill() {
    if (this.process) {
      try {
        this.process.kill("SIGKILL");
      } catch {
      }
      this.process = null;
      this.initialized = false;
      for (const waiters of this.diagnosticWaiters.values()) {
        for (const wake of waiters) wake();
      }
      this.diagnosticWaiters.clear();
    }
  }
  /**
   * Disconnect from the LSP server
   */
  async disconnect() {
    if (!this.process) return;
    try {
      await this.request("shutdown", null, 3e3);
      this.notify("exit", null);
    } catch {
    } finally {
      if (this.process) {
        this.process.kill();
        this.process = null;
      }
      this.initialized = false;
      this.rejectPendingRequests(new Error("Client disconnected"));
      this.openDocuments.clear();
      this.diagnostics.clear();
      for (const waiters of this.diagnosticWaiters.values()) {
        for (const wake of waiters) wake();
      }
      this.diagnosticWaiters.clear();
    }
  }
  /**
   * Reject all pending requests with the given error.
   * Called on process exit to avoid dangling unresolved promises.
   */
  rejectPendingRequests(error) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }
  /**
   * Handle incoming data from the server
   */
  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    if (this.buffer.length > _LspClient.MAX_BUFFER_SIZE) {
      console.error("[LSP] Response buffer exceeded 50MB limit, resetting");
      this.buffer = Buffer.alloc(0);
      this.rejectPendingRequests(new Error("LSP response buffer overflow"));
      return;
    }
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const header = this.buffer.subarray(0, headerEnd).toString();
      const contentLengthMatch = header.match(/Content-Length: (\d+)/i);
      if (!contentLengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) {
        break;
      }
      const messageJson = this.buffer.subarray(messageStart, messageEnd).toString();
      this.buffer = this.buffer.subarray(messageEnd);
      try {
        const message = JSON.parse(messageJson);
        this.handleMessage(message);
      } catch {
      }
    }
  }
  /**
   * Handle a parsed JSON-RPC message
   */
  handleMessage(message) {
    const record = message;
    const hasOwnMethod = Object.prototype.hasOwnProperty.call(message, "method");
    const hasOwnId = Object.prototype.hasOwnProperty.call(message, "id");
    if (hasOwnMethod && typeof record.method === "string") {
      const id = record.id;
      if (hasOwnId) {
        if (typeof id === "string" || typeof id === "number" && Number.isInteger(id)) {
          this.handleServerRequest(message);
        }
        return;
      }
      this.handleNotification(message);
      return;
    }
    if (!hasOwnMethod && hasOwnId && typeof record.id === "number") {
      const response = message;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new LspResponseError(
            response.error.code,
            response.error.message,
            response.error.data
          ));
        } else {
          pending.resolve(response.result);
        }
      }
    }
  }
  /** Reply to unsupported server requests without claiming they succeeded. */
  handleServerRequest(request) {
    const error = request.method === "client/registerCapability" ? { code: -32803, message: "Dynamic capability registration is not supported" } : { code: -32601, message: "Method not found" };
    const response = { jsonrpc: "2.0", id: request.id, error };
    const content = JSON.stringify(response);
    this.process?.stdin?.write(`Content-Length: ${Buffer.byteLength(content)}\r
\r
${content}`);
  }
  /**
   * Handle server notifications
   */
  handleNotification(notification) {
    if (notification.method === "textDocument/publishDiagnostics") {
      const params = this.translateIncomingPayload(notification.params);
      this.diagnostics.set(params.uri, params.diagnostics);
      this.diagnosticsUpdatedAt.set(params.uri, Date.now());
      this.diagnosticsSeq.set(params.uri, (this.diagnosticsSeq.get(params.uri) ?? 0) + 1);
      const waiters = this.diagnosticWaiters.get(params.uri);
      if (waiters && waiters.length > 0) {
        this.diagnosticWaiters.delete(params.uri);
        for (const wake of waiters) wake();
      }
      return;
    }
    if (notification.method === "experimental/serverStatus") {
      const params = notification.params;
      if (typeof params?.quiescent === "boolean") {
        this.sawReadinessSignal = true;
        this.serverQuiescent = params.quiescent;
      }
      return;
    }
  }
  /**
   * What we currently know about the server's index.
   *
   * Reading this is free — it never talks to the server — so a warm, non-empty
   * answer costs nothing to qualify.
   */
  get indexState() {
    if (this.sawReadinessSignal) {
      return this.serverQuiescent ? "ready" : "indexing";
    }
    if (this.connectedAt === 0) {
      return "unknown";
    }
    if (Date.now() - this.connectedAt < INDEX_COLD_WINDOW_MS) {
      return "unknown";
    }
    return "ready";
  }
  /**
   * Send a request to the server, retrying transient failures.
   *
   * `ContentModified` (-32801) means the server's state changed between request
   * and response — a file was edited while the request was in flight. The spec
   * treats it as expected and transient. Surfacing it verbatim produced
   * "Error in goto implementation: content modified", which reads as a dead end
   * and pushes a caller back to grep; re-asking is what it actually calls for.
   *
   * `ServerCancelled` (-32802) is the same deal from the other side: the server
   * dropped the request itself and the spec says to re-send. It only became
   * reachable once clients started outliving a single request — see the constant.
   *
   * Matching is on the numeric code, never the message: the message is
   * server-chosen prose and may be reworded or localised.
   */
  async request(method, params, timeout) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.sendRequestOnce(method, params, timeout);
      } catch (error) {
        const retryable = error instanceof LspResponseError && RETRYABLE_LSP_CODES.has(error.code);
        if (!retryable) {
          throw error;
        }
        if (attempt >= CONTENT_MODIFIED_MAX_ATTEMPTS) {
          const wasCancelled = error.code === LSP_SERVER_CANCELLED;
          throw new LspResponseError(
            error.code,
            wasCancelled ? `the server cancelled request '${method}' (LSP ServerCancelled) on all ${CONTENT_MODIFIED_MAX_ATTEMPTS} attempts. This normally happens while a workspace is being loaded and clears once indexing settles.` : `the server reported its content kept changing under request '${method}' (LSP ContentModified) on all ${CONTENT_MODIFIED_MAX_ATTEMPTS} attempts. This is normally transient and clears on its own; if the file is being written to continuously, retry once it settles.`
          );
        }
        await sleep(CONTENT_MODIFIED_BACKOFF_MS[attempt - 1] ?? 150);
      }
    }
  }
  /**
   * Ask an index-dependent method, re-asking while the server says it is still
   * indexing and the answer is empty.
   *
   * The shape matters: a non-empty answer returns on the first pass, and so does
   * an empty one from a server that reports itself ready. Only the combination
   * "empty AND the server SAYS it is indexing" waits — which is the one case
   * where today's answer is simply wrong.
   *
   * A server that reports nothing ('unknown') is deliberately NOT retried. We
   * have no evidence it is busy, and blindly re-asking cost a measured 5.2s on a
   * genuinely empty clangd query instead of 0.23s. The caller is told the answer
   * is inconclusive instead — see indexCaveat() — which is what we actually know.
   */
  async requestIndexed(method, params, timeout) {
    let result = await this.request(method, params, timeout);
    if (!isEmptyLspResult(result) || !INDEX_DEPENDENT_METHODS.has(method)) {
      return result;
    }
    const deadline = Date.now() + INDEX_READY_RETRY_BUDGET_MS;
    let backoff = 150;
    while (this.indexState === "indexing" && Date.now() < deadline) {
      await sleep(Math.min(backoff, Math.max(0, deadline - Date.now())));
      backoff = Math.min(backoff * 2, 1e3);
      result = await this.request(method, params, timeout);
      if (!isEmptyLspResult(result)) {
        return result;
      }
    }
    return result;
  }
  /**
   * Send a request to the server (single attempt)
   */
  async sendRequestOnce(method, params, timeout) {
    if (!this.process?.stdin) {
      throw new Error("LSP server not connected");
    }
    const effectiveTimeout = timeout ?? getLspRequestTimeout(this.serverConfig, method);
    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };
    const content = JSON.stringify(request);
    const message = `Content-Length: ${Buffer.byteLength(content)}\r
\r
${content}`;
    return new Promise((resolve4, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);
      this.pendingRequests.set(id, {
        resolve: resolve4,
        reject,
        timeout: timeoutHandle
      });
      this.process?.stdin?.write(message);
    });
  }
  /**
   * Send a notification to the server (no response expected)
   */
  notify(method, params) {
    if (!this.process?.stdin) return;
    const notification = {
      jsonrpc: "2.0",
      method,
      params
    };
    const content = JSON.stringify(notification);
    const message = `Content-Length: ${Buffer.byteLength(content)}\r
\r
${content}`;
    this.process.stdin.write(message);
  }
  /**
   * Initialize the LSP connection
   */
  async initialize() {
    const initResult = await this.request("initialize", {
      processId: process.pid,
      rootUri: this.getWorkspaceRootUri(),
      rootPath: this.getServerWorkspaceRoot(),
      // We advertise workspace.workspaceFolders below, so a server is entitled
      // to read this list — and omitting it is not the same as not supporting
      // folders. Measured on taplo: with the field absent it logs "using
      // detached workspace" and answers every .toml with the single hint
      // "this document has been excluded" instead of linting it, so a file with
      // a duplicate key reported clean. Sending the one folder we already know
      // about turns the same file into "conflicting keys" (severity 1).
      workspaceFolders: [{
        uri: this.getWorkspaceRootUri(),
        name: (0, import_path4.basename)(this.getServerWorkspaceRoot()) || "workspace"
      }],
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          implementation: { linkSupport: true },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: [] } } },
          rename: { prepareSupport: true },
          // Omitting dynamicRegistration means false, which is what we want:
          // handleServerRequest rejects client/registerCapability.
          callHierarchy: {},
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: { valueSet: [1, 2] }
          }
        },
        workspace: {
          symbol: {},
          workspaceFolders: true
        },
        // Opt in to rust-analyzer's readiness notification. Without this the
        // server sends nothing at all and a still-indexing answer is
        // indistinguishable from an empty one. Servers that don't know the
        // capability ignore it.
        experimental: {
          serverStatusNotification: true
        }
      },
      initializationOptions: this.serverConfig.initializationOptions || {}
    }, getLspRequestTimeout(this.serverConfig, "initialize"));
    this._serverCapabilities = initResult?.capabilities ?? null;
    this._supportsPullDiagnostics = !!this._serverCapabilities?.diagnosticProvider;
    this.notify("initialized", {});
  }
  /**
   * Open a document for editing
   */
  async openDocument(filePath) {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);
    if (this.openDocuments.has(hostUri)) return;
    if (!(0, import_fs3.existsSync)(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const content = (0, import_fs3.readFileSync)(filePath, "utf-8");
    const languageId = this.getLanguageId(filePath);
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content
      }
    });
    this.openDocuments.add(hostUri);
    await new Promise((resolve4) => setTimeout(resolve4, 100));
  }
  /**
   * Close a document
   */
  closeDocument(filePath) {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);
    if (!this.openDocuments.has(hostUri)) return;
    this.notify("textDocument/didClose", {
      textDocument: { uri }
    });
    this.openDocuments.delete(hostUri);
  }
  /**
   * Get the language ID for a file
   */
  getLanguageId(filePath) {
    const ext = (0, import_path4.parse)(filePath).ext.slice(1).toLowerCase();
    const langMap = {
      "ts": "typescript",
      "tsx": "typescriptreact",
      "js": "javascript",
      "jsx": "javascriptreact",
      "mts": "typescript",
      "cts": "typescript",
      "mjs": "javascript",
      "cjs": "javascript",
      "py": "python",
      "rs": "rust",
      "go": "go",
      "c": "c",
      "h": "c",
      "cpp": "cpp",
      "cc": "cpp",
      "hpp": "cpp",
      "java": "java",
      "json": "json",
      "html": "html",
      "css": "css",
      "scss": "scss",
      "yaml": "yaml",
      "yml": "yaml",
      "php": "php",
      "phtml": "php",
      "rb": "ruby",
      "rake": "ruby",
      "gemspec": "ruby",
      "erb": "ruby",
      "lua": "lua",
      "kt": "kotlin",
      "kts": "kotlin",
      "ex": "elixir",
      "exs": "elixir",
      "heex": "elixir",
      "eex": "elixir",
      "cs": "csharp"
    };
    return langMap[ext] || ext;
  }
  /**
   * Convert file path to URI and ensure document is open
   */
  async prepareDocument(filePath) {
    await this.openDocument(filePath);
    return this.toServerUri(fileUri(filePath));
  }
  // LSP Request Methods
  /**
   * Get hover information at a position
   */
  async hover(filePath, line, character) {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request("textDocument/hover", {
      textDocument: { uri },
      position: { line, character }
    });
    return this.translateIncomingPayload(result);
  }
  /**
   * Go to definition
   */
  async definition(filePath, line, character) {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request("textDocument/definition", {
      textDocument: { uri },
      position: { line, character }
    });
    return this.translateIncomingPayload(result);
  }
  /**
   * Go to implementation
   */
  async implementation(filePath, line, character) {
    const uri = await this.prepareDocument(filePath);
    const result = await this.requestIndexed("textDocument/implementation", {
      textDocument: { uri },
      position: { line, character }
    });
    return this.translateIncomingPayload(result);
  }
  /**
   * Find all references
   */
  async references(filePath, line, character, includeDeclaration = true) {
    const uri = await this.prepareDocument(filePath);
    const result = await this.requestIndexed("textDocument/references", {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration }
    });
    return this.translateIncomingPayload(result);
  }
  /**
   * Get document symbols
   */
  async documentSymbols(filePath) {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request("textDocument/documentSymbol", {
      textDocument: { uri }
    });
    return this.translateIncomingPayload(result);
  }
  /**
   * Search workspace symbols
   */
  async workspaceSymbols(query) {
    const result = await this.requestIndexed("workspace/symbol", { query });
    return this.translateIncomingPayload(result);
  }
  /**
   * Get diagnostics for a file
   */
  getDiagnostics(filePath) {
    const uri = fileUri(filePath);
    return this.diagnostics.get(uri) || [];
  }
  /**
   * Whether the server supports LSP 3.17 pull diagnostics (textDocument/diagnostic).
   */
  get supportsPullDiagnostics() {
    return this._supportsPullDiagnostics;
  }
  /**
   * Request diagnostics via the LSP 3.17 pull model (textDocument/diagnostic).
   * Only call when supportsPullDiagnostics is true.
   */
  async pullDiagnostics(filePath) {
    const uri = this.toServerUri(fileUri(filePath));
    const result = await this.request(
      "textDocument/diagnostic",
      { textDocument: { uri } }
    );
    return (result?.items || []).map((d) => ({
      range: d.range,
      message: d.message,
      severity: d.severity,
      source: d.source,
      code: d.code
    }));
  }
  /**
   * Diagnostics for a file, by whichever model the server actually honours.
   *
   * Capability advertisement is not a promise. Measured today:
   *   - vscode-json-language-server advertises `diagnosticProvider` and answers
   *     `textDocument/diagnostic` with -32601 "Unhandled method". The pull-only
   *     path turned that into "Error in diagnostics: ..." and reported nothing,
   *     while the very same server was pushing "Trailing comma" over
   *     publishDiagnostics the whole time.
   *   - taplo and yaml-language-server advertise no provider at all and are
   *     push-only.
   *
   * So: try pull when it is advertised, and on a *method not found* refusal fall
   * back to the push cache and stop asking for the rest of the connection. Only
   * -32601 is treated this way — a timeout or ContentModified is a real failure
   * and must not be silently downgraded into "the server had nothing to say".
   */
  async collectDiagnostics(filePath, pushWaitMs = 3e4, publishedAfterSeq = -1) {
    if (this._supportsPullDiagnostics && !this.pullDiagnosticsRefused) {
      try {
        const pulled = await this.pullDiagnostics(filePath);
        this.diagnosticsAnsweredFor.add(fileUri(filePath));
        return pulled;
      } catch (error) {
        const refused = error instanceof LspResponseError && error.code === LSP_METHOD_NOT_FOUND;
        if (!refused) {
          throw error;
        }
        this.pullDiagnosticsRefused = true;
      }
    }
    await this.waitForDiagnosticsSettled(filePath, pushWaitMs, DIAGNOSTICS_SETTLE_MS, publishedAfterSeq);
    if (this.diagnosticsUpdatedAt.has(fileUri(filePath))) {
      this.diagnosticsAnsweredFor.add(fileUri(filePath));
    }
    return this.getDiagnostics(filePath);
  }
  /**
   * Whether the server has actually said anything about this file — a pull
   * response, or at least one publishDiagnostics.
   *
   * An empty diagnostic list is ambiguous on its own: it is what a clean file
   * and a server that has not looked yet both produce. This separates the two,
   * so a caller can decline to claim "clean" rather than guess. It is about
   * diagnostics specifically, unlike indexState, which describes the
   * workspace-wide index that reference/implementation queries depend on.
   */
  diagnosticsAnswered(filePath) {
    return this.diagnosticsAnsweredFor.has(fileUri(filePath));
  }
  /**
   * Wait for a push-model server's diagnostics to stop changing.
   *
   * First publish, then quiet for DIAGNOSTICS_SETTLE_MS. See that constant for
   * the measurement this exists for: the first publish is routinely a stale or
   * empty placeholder, and returning on it reports "clean" for a broken file.
   */
  async waitForDiagnosticsSettled(filePath, timeoutMs = 3e4, settleMs = DIAGNOSTICS_SETTLE_MS, publishedAfterSeq = -1) {
    const uri = fileUri(filePath);
    const deadline = Date.now() + timeoutMs;
    while ((this.diagnosticsSeq.get(uri) ?? 0) <= publishedAfterSeq && Date.now() < deadline) {
      await this.awaitPublish(uri, deadline - Date.now());
    }
    if (!this.diagnostics.has(uri)) {
      await this.waitForDiagnostics(filePath, Math.max(0, deadline - Date.now()));
    }
    if (!this.diagnosticsUpdatedAt.has(uri)) {
      return;
    }
    for (; ; ) {
      const quietFor = Date.now() - (this.diagnosticsUpdatedAt.get(uri) ?? 0);
      const remaining = deadline - Date.now();
      if (quietFor >= settleMs || remaining <= 0) {
        return;
      }
      await sleep(Math.min(settleMs - quietFor, remaining));
    }
  }
  /**
   * Open a document using text we supply rather than the bytes on disk.
   *
   * LSP treats the client as the owner of an open document's content, so this
   * is how the server can be asked about a version of the file that is not (or
   * is no longer) on disk — without ever writing that version to the real path.
   * The real path is still used, so imports, tsconfig and crate layout resolve
   * exactly as they do for the actual file.
   */
  async openDocumentWithText(filePath, text) {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);
    if (this.openDocuments.has(hostUri)) {
      return this.changeDocument(filePath, text);
    }
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: this.getLanguageId(filePath), version: 1, text }
    });
    this.openDocuments.add(hostUri);
    this.documentVersions.set(hostUri, 1);
    return -1;
  }
  /**
   * Replace the content of an already-open document (full-text didChange).
   * Returns the moment the change was sent, so a caller can tell a publish that
   * answers this change apart from one that answered the previous content.
   */
  changeDocument(filePath, text) {
    const hostUri = fileUri(filePath);
    const uri = this.toServerUri(hostUri);
    const version = (this.documentVersions.get(hostUri) ?? 1) + 1;
    const seenSeq = this.diagnosticsSeq.get(hostUri) ?? 0;
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }]
    });
    this.documentVersions.set(hostUri, version);
    return seenSeq;
  }
  /**
   * Wait for the server to publish diagnostics for a file.
   * Resolves as soon as textDocument/publishDiagnostics fires for the URI,
   * or after `timeoutMs` milliseconds (whichever comes first).
   * This replaces fixed-delay sleeps with a notification-driven approach.
   */
  waitForDiagnostics(filePath, timeoutMs = 2e3) {
    const uri = fileUri(filePath);
    if (this.diagnostics.has(uri)) {
      return Promise.resolve();
    }
    return this.awaitPublish(uri, timeoutMs);
  }
  /**
   * Wait for the NEXT publishDiagnostics for a URI, whether or not one is
   * already cached. Needed after a didChange: the cache still holds the answer
   * to the previous content, so the cached-value shortcut would return a
   * verdict about text the server has already been told to forget.
   */
  awaitPublish(uri, timeoutMs) {
    return new Promise((resolve4) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.diagnosticWaiters.delete(uri);
          resolve4();
        }
      }, timeoutMs);
      const existing = this.diagnosticWaiters.get(uri) || [];
      existing.push(() => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve4();
        }
      });
      this.diagnosticWaiters.set(uri, existing);
    });
  }
  /**
   * Prepare rename (check if rename is valid)
   */
  async prepareRename(filePath, line, character) {
    const uri = await this.prepareDocument(filePath);
    try {
      const result = await this.request("textDocument/prepareRename", {
        textDocument: { uri },
        position: { line, character }
      });
      if (!result) return null;
      return "range" in result ? result.range : result;
    } catch {
      return null;
    }
  }
  /**
   * Rename a symbol
   */
  async rename(filePath, line, character, newName) {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request("textDocument/rename", {
      textDocument: { uri },
      position: { line, character },
      newName
    });
    return this.translateIncomingPayload(result);
  }
  /**
   * Get code actions
   */
  async codeActions(filePath, range, diagnostics = []) {
    const uri = await this.prepareDocument(filePath);
    const result = await this.request("textDocument/codeAction", {
      textDocument: { uri },
      range,
      context: { diagnostics }
    });
    return this.translateIncomingPayload(result);
  }
  /**
   * Resolve the call-hierarchy symbol at a position, leaving URIs untranslated.
   *
   * The raw item is what has to go back to the server on the follow-up request:
   * translateIncomingPayload rewrites `uri` to the host namespace, and a
   * container-hosted server would not recognise a host URI it never issued.
   */
  async prepareCallHierarchyRaw(filePath, line, character) {
    const uri = await this.prepareDocument(filePath);
    return this.requestIndexed("textDocument/prepareCallHierarchy", {
      textDocument: { uri },
      position: { line, character }
    });
  }
  /**
   * Resolve the call-hierarchy item(s) at a position.
   */
  async prepareCallHierarchy(filePath, line, character) {
    const result = await this.prepareCallHierarchyRaw(filePath, line, character);
    return this.translateIncomingPayload(result);
  }
  /**
   * Find the callers of the symbol at a position.
   *
   * Takes a position and re-prepares internally rather than accepting a
   * CallHierarchyItem, even though that costs one extra round-trip against an
   * already-open document. Two reasons, in order of weight:
   *
   *   1. CallHierarchyItem.data is server-defined opaque state. Clients are
   *      pooled and evicted after IDLE_TIMEOUT_MS, so an item handed back later
   *      can reach a *different* server process than the one that minted it.
   *      A position always means the same thing; an opaque blob does not.
   *   2. A caller that has to thread JSON from one tool call into the next will
   *      eventually thread it wrong, and a malformed item fails as an obscure
   *      server error rather than as "no symbol there".
   */
  async incomingCalls(filePath, line, character) {
    const items = await this.prepareCallHierarchyRaw(filePath, line, character);
    const item = items?.[0];
    if (!item) return null;
    const result = await this.requestIndexed("callHierarchy/incomingCalls", { item });
    return this.translateIncomingPayload({ item, calls: result ?? [] });
  }
  /**
   * Find what the symbol at a position calls. Position-based for the same
   * reasons as incomingCalls().
   */
  async outgoingCalls(filePath, line, character) {
    const items = await this.prepareCallHierarchyRaw(filePath, line, character);
    const item = items?.[0];
    if (!item) return null;
    const result = await this.requestIndexed("callHierarchy/outgoingCalls", { item });
    return this.translateIncomingPayload({ item, calls: result ?? [] });
  }
  getServerWorkspaceRoot() {
    return this.devContainerContext?.containerWorkspaceRoot ?? this.workspaceRoot;
  }
  getWorkspaceRootUri() {
    return this.toServerUri((0, import_url2.pathToFileURL)(this.workspaceRoot).href);
  }
  toServerUri(uri) {
    return hostUriToContainerUri(uri, this.devContainerContext);
  }
  toHostUri(uri) {
    return containerUriToHostUri(uri, this.devContainerContext);
  }
  translateIncomingPayload(value) {
    if (!this.devContainerContext || value == null) {
      return value;
    }
    return this.translateIncomingValue(value);
  }
  translateIncomingValue(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this.translateIncomingValue(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    const record = value;
    const translatedEntries = Object.entries(record).map(([key, entryValue]) => {
      if ((key === "uri" || key === "targetUri" || key === "newUri" || key === "oldUri") && typeof entryValue === "string") {
        return [key, this.toHostUri(entryValue)];
      }
      if (key === "changes" && entryValue && typeof entryValue === "object" && !Array.isArray(entryValue)) {
        const translatedChanges = Object.fromEntries(
          Object.entries(entryValue).map(([uri, changeValue]) => [
            this.toHostUri(uri),
            this.translateIncomingValue(changeValue)
          ])
        );
        return [key, translatedChanges];
      }
      return [key, this.translateIncomingValue(entryValue)];
    });
    return Object.fromEntries(translatedEntries);
  }
};
var IDLE_TIMEOUT_MS = readPositiveIntEnv("NORD_LSP_IDLE_TIMEOUT_MS", 5 * 60 * 1e3);
var IDLE_CHECK_INTERVAL_MS = readPositiveIntEnv("NORD_LSP_IDLE_CHECK_INTERVAL_MS", 60 * 1e3);
var LspClientManager = class {
  clients = /* @__PURE__ */ new Map();
  lastUsed = /* @__PURE__ */ new Map();
  inFlightCount = /* @__PURE__ */ new Map();
  idleDeadlines = /* @__PURE__ */ new Map();
  idleTimer = null;
  constructor() {
    this.startIdleCheck();
    this.registerCleanupHandlers();
  }
  /**
   * Register process exit/signal handlers to kill all spawned LSP server processes.
   * Prevents orphaned language server processes (e.g. kotlin-language-server)
   * when the MCP bridge process exits or a claude session ends.
   */
  registerCleanupHandlers() {
    const forceKillAll = () => {
      if (this.idleTimer) {
        clearInterval(this.idleTimer);
        this.idleTimer = null;
      }
      for (const timer of this.idleDeadlines.values()) {
        clearTimeout(timer);
      }
      this.idleDeadlines.clear();
      for (const client of this.clients.values()) {
        try {
          client.forceKill();
        } catch {
        }
      }
      this.clients.clear();
      this.lastUsed.clear();
      this.inFlightCount.clear();
    };
    process.on("exit", forceKillAll);
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
      process.on(sig, forceKillAll);
    }
  }
  /**
   * Get or create a client for a file
   */
  async getClientForFile(filePath) {
    const workspaceRoot = this.findWorkspaceRoot(filePath);
    const serverConfig = getServerForFile(filePath, workspaceRoot);
    if (!serverConfig) {
      return null;
    }
    const devContainerContext = resolveDevContainerContext(workspaceRoot);
    const key = `${workspaceRoot}:${serverConfig.command}:${devContainerContext?.containerId ?? "host"}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new LspClient(workspaceRoot, serverConfig, devContainerContext);
      try {
        await client.connect();
        this.clients.set(key, client);
      } catch (error) {
        throw error;
      }
    }
    this.touchClient(key);
    return client;
  }
  /**
   * Run a function with in-flight tracking for the client serving filePath.
   * While the function is running, the client is protected from idle eviction.
   * The lastUsed timestamp is refreshed on both entry and exit.
   */
  async runWithClientLease(filePath, fn) {
    const workspaceRoot = this.findWorkspaceRoot(filePath);
    const serverConfig = getServerForFile(filePath, workspaceRoot);
    if (!serverConfig) {
      throw new Error(`No language server available for: ${filePath}`);
    }
    const devContainerContext = resolveDevContainerContext(workspaceRoot);
    const key = `${workspaceRoot}:${serverConfig.command}:${devContainerContext?.containerId ?? "host"}`;
    let client = this.clients.get(key);
    if (!client) {
      client = new LspClient(workspaceRoot, serverConfig, devContainerContext);
      try {
        await client.connect();
        this.clients.set(key, client);
      } catch (error) {
        throw error;
      }
    }
    this.touchClient(key);
    this.inFlightCount.set(key, (this.inFlightCount.get(key) || 0) + 1);
    try {
      return await fn(client);
    } finally {
      const count = (this.inFlightCount.get(key) || 1) - 1;
      if (count <= 0) {
        this.inFlightCount.delete(key);
      } else {
        this.inFlightCount.set(key, count);
      }
      this.touchClient(key);
    }
  }
  touchClient(key) {
    this.lastUsed.set(key, Date.now());
    this.scheduleIdleDeadline(key);
  }
  scheduleIdleDeadline(key) {
    this.clearIdleDeadline(key);
    const timer = setTimeout(() => {
      this.idleDeadlines.delete(key);
      this.evictClientIfIdle(key);
    }, IDLE_TIMEOUT_MS);
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    this.idleDeadlines.set(key, timer);
  }
  clearIdleDeadline(key) {
    const timer = this.idleDeadlines.get(key);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.idleDeadlines.delete(key);
  }
  /**
   * Find the workspace root for a file
   */
  findWorkspaceRoot(filePath) {
    let dir = (0, import_path4.dirname)((0, import_path4.resolve)(filePath));
    const markers = [
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "settings.gradle.kts",
      "pom.xml",
      "package.json",
      "tsconfig.json",
      "pyproject.toml",
      "Cargo.toml",
      "go.mod",
      ".git"
    ];
    while (true) {
      const parsed = (0, import_path4.parse)(dir);
      if (parsed.root === dir) {
        break;
      }
      for (const marker of markers) {
        const markerPath = (0, import_path4.join)(dir, marker);
        if ((0, import_fs3.existsSync)(markerPath)) {
          return dir;
        }
      }
      dir = (0, import_path4.dirname)(dir);
    }
    return (0, import_path4.dirname)((0, import_path4.resolve)(filePath));
  }
  /**
   * Start periodic idle check
   */
  startIdleCheck() {
    if (this.idleTimer) return;
    this.idleTimer = setInterval(() => {
      this.evictIdleClients();
    }, IDLE_CHECK_INTERVAL_MS);
    if (this.idleTimer && typeof this.idleTimer === "object" && "unref" in this.idleTimer) {
      this.idleTimer.unref();
    }
  }
  /**
   * Evict clients that haven't been used within IDLE_TIMEOUT_MS.
   * Clients with in-flight requests are never evicted.
   */
  evictIdleClients() {
    for (const key of this.lastUsed.keys()) {
      this.evictClientIfIdle(key);
    }
  }
  evictClientIfIdle(key) {
    const lastUsedTime = this.lastUsed.get(key);
    if (lastUsedTime === void 0) {
      this.clearIdleDeadline(key);
      return;
    }
    const idleFor = Date.now() - lastUsedTime;
    if (idleFor <= IDLE_TIMEOUT_MS) {
      const hasDeadline = this.idleDeadlines.has(key);
      if (!hasDeadline) {
        this.scheduleIdleDeadline(key);
      }
      return;
    }
    if ((this.inFlightCount.get(key) || 0) > 0) {
      this.scheduleIdleDeadline(key);
      return;
    }
    const client = this.clients.get(key);
    this.clearIdleDeadline(key);
    this.clients.delete(key);
    this.lastUsed.delete(key);
    this.inFlightCount.delete(key);
    if (client) {
      client.disconnect().catch(() => {
      });
    }
  }
  /**
   * Disconnect all clients and stop idle checking.
   * Uses Promise.allSettled so one failing disconnect doesn't block others.
   * Maps are always cleared regardless of individual disconnect failures.
   */
  async disconnectAll() {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    for (const timer of this.idleDeadlines.values()) {
      clearTimeout(timer);
    }
    this.idleDeadlines.clear();
    const entries = Array.from(this.clients.entries());
    const results = await Promise.allSettled(
      entries.map(([, client]) => client.disconnect())
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const key = entries[i][0];
        console.warn(`LSP disconnectAll: failed to disconnect client "${key}": ${result.reason}`);
      }
    }
    this.clients.clear();
    this.lastUsed.clear();
    this.inFlightCount.clear();
  }
  /** Expose in-flight count for testing */
  getInFlightCount(key) {
    return this.inFlightCount.get(key) || 0;
  }
  /** Expose client count for testing */
  get clientCount() {
    return this.clients.size;
  }
  /**
   * Pids of every language server currently pooled.
   *
   * The daemon reports these so "did this run leak a language server" can be
   * answered by ownership instead of by grepping ps for command names, which
   * cannot tell our servers from an editor's.
   */
  getServerPids() {
    const pids = [];
    for (const client of this.clients.values()) {
      const pid = client.serverPid;
      if (pid !== void 0) pids.push(pid);
    }
    return pids;
  }
  /** Trigger idle eviction manually (exposed for testing) */
  triggerEviction() {
    this.evictIdleClients();
  }
};
var LSP_CLIENT_MANAGER_KEY = "__nordLspClientManager";
var globalWithLspClientManager = globalThis;
var lspClientManager = globalWithLspClientManager[LSP_CLIENT_MANAGER_KEY] ?? (globalWithLspClientManager[LSP_CLIENT_MANAGER_KEY] = new LspClientManager());
async function disconnectAll() {
  return lspClientManager.disconnectAll();
}

// src/tools/lsp/edit-diagnostics.ts
async function editDiagnostics(req) {
  const { file, beforeText, afterText, budgetMs, waitReadyMs } = req;
  return lspClientManager.runWithClientLease(file, async (client) => {
    if (waitReadyMs > 0) {
      const until = Date.now() + waitReadyMs;
      while (client.indexState !== "ready" && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    let before = [];
    let after;
    if (beforeText === null) {
      await client.openDocument(file);
      after = await client.collectDiagnostics(file, budgetMs);
    } else {
      const baseSeq = await client.openDocumentWithText(file, beforeText);
      before = await client.collectDiagnostics(file, budgetMs, baseSeq);
      const sentAt = client.changeDocument(file, afterText);
      after = await client.collectDiagnostics(file, budgetMs, sentAt);
    }
    return { before, after, answered: client.diagnosticsAnswered(file), indexState: client.indexState };
  });
}

// src/tools/lsp/diag-socket.ts
var import_net = require("net");
var import_fs4 = require("fs");
var import_os = require("os");
var import_path5 = require("path");
function diagSocketDir() {
  return (0, import_path5.join)((0, import_os.tmpdir)(), `nord-lsp-${process.getuid ? process.getuid() : 0}`);
}
function startDiagSocket() {
  try {
    const dir = diagSocketDir();
    (0, import_fs4.mkdirSync)(dir, { recursive: true, mode: 448 });
    const path = (0, import_path5.join)(dir, `${process.pid}.sock`);
    if ((0, import_fs4.existsSync)(path)) (0, import_fs4.unlinkSync)(path);
    const server = (0, import_net.createServer)((conn) => {
      let buf = "";
      conn.setEncoding("utf8");
      conn.on("data", async (chunk) => {
        buf += chunk;
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        let reply;
        try {
          reply = await editDiagnostics(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reply = { error: e instanceof Error ? e.message : String(e) };
        }
        conn.end(JSON.stringify(reply) + "\n");
      });
      conn.on("error", () => {
      });
    });
    server.on("error", () => {
    });
    server.listen(path, () => {
      try {
        (0, import_fs4.chmodSync)(path, 384);
      } catch {
      }
    });
    server.unref();
    process.once("exit", () => {
      try {
        (0, import_fs4.unlinkSync)(path);
      } catch {
      }
    });
  } catch {
  }
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function ask(path, req, timeoutMs) {
  return new Promise((resolve4) => {
    let buf = "";
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        conn.destroy();
        resolve4(v);
      }
    };
    const conn = (0, import_net.createConnection)(path, () => conn.write(JSON.stringify(req) + "\n"));
    conn.setEncoding("utf8");
    conn.setTimeout(timeoutMs, () => finish(null));
    conn.on("data", (chunk) => {
      buf += chunk;
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      try {
        const r = JSON.parse(buf.slice(0, nl));
        finish(r && Array.isArray(r.after) ? r : null);
      } catch {
        finish(null);
      }
    });
    conn.on("error", () => finish(null));
    conn.on("close", () => finish(null));
  });
}
async function requestEditDiagnostics(req, timeoutMs) {
  const dir = diagSocketDir();
  let names;
  try {
    names = (0, import_fs4.readdirSync)(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    const m = /^(\d+)\.sock$/.exec(name);
    if (!m) continue;
    const path = (0, import_path5.join)(dir, name);
    if (!alive(Number(m[1]))) {
      try {
        (0, import_fs4.unlinkSync)(path);
      } catch {
      }
      continue;
    }
    const r = await ask(path, req, timeoutMs);
    if (r) return r;
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  commandExists,
  disconnectAll,
  editDiagnostics,
  getServerForFile,
  requestEditDiagnostics,
  startDiagSocket
});
