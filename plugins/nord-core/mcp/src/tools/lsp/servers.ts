/**
 * LSP Server Configurations
 *
 * Defines known language servers and their configurations.
 * Supports auto-detection and installation hints.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, realpathSync } from 'fs';
import { delimiter, dirname, extname, isAbsolute, join, parse, resolve } from 'path';

export interface LspServerConfig {
  name: string;
  command: string;
  args: string[];
  extensions: string[];
  installHint: string;
  initializationOptions?: Record<string, unknown>;
  initializeTimeoutMs?: number;
}

const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

const TYPESCRIPT_CLASSIC_SERVER: LspServerConfig = {
  name: 'TypeScript Language Server',
  command: 'typescript-language-server',
  args: ['--stdio'],
  extensions: TYPESCRIPT_EXTENSIONS,
  installHint: 'npm install -g typescript-language-server typescript'
};

function getTypeScriptNativeBin(packageRoot: string): string {
  const packageNodeModules = dirname(packageRoot);
  const workspaceRoot = dirname(packageNodeModules);
  const executable = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
  return join(workspaceRoot, 'node_modules', '.bin', executable);
}

function findTypeScriptPackageRoot(workspaceRoot: string): string | null {
  let dir = resolve(workspaceRoot);

  while (true) {
    const packageJsonPath = join(dir, 'node_modules', 'typescript', 'package.json');
    if (existsSync(packageJsonPath)) {
      return dirname(packageJsonPath);
    }

    const parsed = parse(dir);
    if (parsed.root === dir) {
      return null;
    }

    dir = dirname(dir);
  }
}

function readTypeScriptMajorVersion(packageRoot: string): number | null {
  try {
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown };
    if (typeof packageJson.version !== 'string') {
      return null;
    }

    const major = Number.parseInt(packageJson.version.split('.')[0] ?? '', 10);
    return Number.isNaN(major) ? null : major;
  } catch {
    return null;
  }
}

function shouldUseNativeTypeScriptServer(packageRoot: string): boolean {
  const majorVersion = readTypeScriptMajorVersion(packageRoot);
  if (majorVersion !== null && majorVersion >= 7) {
    return true;
  }

  if (existsSync(join(packageRoot, 'lib', 'getExePath.js'))) {
    return true;
  }

  return !existsSync(join(packageRoot, 'lib', 'tsserver.js'));
}

/**
 * The `tsc` the shell would run, if it is TypeScript 7 native.
 *
 * A project without its own typescript used to get the classic server, which
 * needs a tsserver from typescript <= 6 -- and a global TypeScript 7 ships
 * none, so such projects got no diagnostics at all. The native server also
 * answers pull diagnostics: an unchanged, clean file is answered in ~80 ms
 * instead of the classic server's 8 s wait for a publish that never comes
 * (measured 2026-09-24; vault: zwei-hooks-ohne-eintrag-in-hooks-json).
 */
function findGlobalNativeTsc(): string | null {
  const executable = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const bin = join(dir, executable);
    if (!existsSync(bin)) continue;
    // Only the first tsc on PATH counts: it is the one the shell would run.
    try {
      const packageRoot = dirname(dirname(realpathSync(bin)));   // <pkg>/bin/tsc
      if (!existsSync(join(packageRoot, 'package.json'))) return null;
      return shouldUseNativeTypeScriptServer(packageRoot) ? bin : null;
    } catch {
      return null;
    }
  }
  return null;
}

function nativeTypeScriptServer(command: string): LspServerConfig {
  return {
    name: 'TypeScript 7 Native Language Server (typescript-go)',
    command,
    args: ['--lsp', '--stdio'],
    extensions: TYPESCRIPT_EXTENSIONS,
    installHint: 'Install TypeScript 7 locally so node_modules/.bin/tsc is available'
  };
}

/**
 * Native beats classic wherever a native server exists: the project's own
 * TS 7 first, then a global TS 7 -- even for a project pinned to classic
 * TypeScript 5/6. Julius, 2026-09-24: the classic server waits 4-8 s per clean
 * edit for a publish that never comes; TS 6 is the bridge to 7 and the
 * differences are small. Classic stays the fallback when no TS 7 is anywhere.
 * ponytail: a project whose code only type-checks under TS 5 would see TS 7's
 * verdict; add a per-project opt-out if one shows up.
 */
export function getTypeScriptServerForWorkspace(workspaceRoot: string): LspServerConfig {
  const packageRoot = findTypeScriptPackageRoot(workspaceRoot);
  if (packageRoot && shouldUseNativeTypeScriptServer(packageRoot)) {
    const localTsc = getTypeScriptNativeBin(packageRoot);
    if (existsSync(localTsc)) {
      return nativeTypeScriptServer(localTsc);
    }
  }
  const globalTsc = findGlobalNativeTsc();
  return globalTsc ? nativeTypeScriptServer(globalTsc) : TYPESCRIPT_CLASSIC_SERVER;
}

/**
 * Known LSP servers and their configurations
 */
export const LSP_SERVERS: Record<string, LspServerConfig> = {
  typescript: TYPESCRIPT_CLASSIC_SERVER,
  python: {
    name: 'Python Language Server (ty)',
    command: 'ty',
    args: ['server'],
    extensions: ['.py', '.pyw'],
    installHint: 'Install ty from https://github.com/astral-sh/ty'
  },
  rust: {
    name: 'Rust Analyzer',
    command: 'rust-analyzer',
    args: [],
    extensions: ['.rs'],
    installHint: 'rustup component add rust-analyzer'
  },
  go: {
    name: 'gopls',
    command: 'gopls',
    args: ['serve'],
    extensions: ['.go'],
    installHint: 'go install golang.org/x/tools/gopls@latest'
  },
  c: {
    name: 'clangd',
    command: 'clangd',
    args: [],
    extensions: ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx'],
    installHint: 'Install clangd from your package manager or LLVM'
  },
  java: {
    name: 'Eclipse JDT Language Server',
    command: 'jdtls',
    args: [],
    extensions: ['.java'],
    installHint: 'Install from https://github.com/eclipse/eclipse.jdt.ls'
  },
  json: {
    name: 'JSON Language Server',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    extensions: ['.json', '.jsonc'],
    installHint: 'npm install -g vscode-langservers-extracted'
  },
  html: {
    name: 'HTML Language Server',
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    extensions: ['.html', '.htm'],
    installHint: 'npm install -g vscode-langservers-extracted'
  },
  css: {
    name: 'CSS Language Server',
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    extensions: ['.css', '.scss', '.less'],
    installHint: 'npm install -g vscode-langservers-extracted'
  },
  vue: {
    name: 'Vue Language Server (Volar)',
    command: 'vue-language-server',
    args: ['--stdio'],
    extensions: ['.vue'],
    installHint: 'npm install -g @vue/language-server'
  },
  toml: {
    name: 'Taplo (TOML)',
    command: 'taplo',
    args: ['lsp', 'stdio'],
    extensions: ['.toml'],
    installHint: 'cargo install taplo-cli --locked, or your package manager'
  },
  yaml: {
    name: 'YAML Language Server',
    command: 'yaml-language-server',
    args: ['--stdio'],
    extensions: ['.yaml', '.yml'],
    installHint: 'npm install -g yaml-language-server'
  },
  php: {
    name: 'PHP Language Server (Intelephense)',
    command: 'intelephense',
    args: ['--stdio'],
    extensions: ['.php', '.phtml'],
    installHint: 'npm install -g intelephense'
  },
  ruby: {
    name: 'Ruby Language Server (Solargraph)',
    command: 'solargraph',
    args: ['stdio'],
    extensions: ['.rb', '.rake', '.gemspec', '.erb'],
    installHint: 'gem install solargraph'
  },
  lua: {
    name: 'Lua Language Server',
    command: 'lua-language-server',
    args: [],
    extensions: ['.lua'],
    installHint: 'Install from https://github.com/LuaLS/lua-language-server'
  },
  kotlin: {
    name: 'Kotlin Language Server',
    command: 'kotlin-lsp',
    args: ['--stdio'],
    extensions: ['.kt', '.kts'],
    installHint: 'Install from https://github.com/Kotlin/kotlin-lsp (brew install JetBrains/utils/kotlin-lsp)',
    initializeTimeoutMs: 5 * 60 * 1000
  },
  elixir: {
    name: 'ElixirLS',
    command: 'elixir-ls',
    args: [],
    extensions: ['.ex', '.exs', '.heex', '.eex'],
    installHint: 'Install from https://github.com/elixir-lsp/elixir-ls'
  },
  csharp: {
    name: 'OmniSharp',
    command: 'omnisharp',
    args: ['-lsp'],
    extensions: ['.cs'],
    installHint: 'dotnet tool install -g omnisharp'
  },
  dart: {
    name: 'Dart Analysis Server',
    command: 'dart',
    args: ['language-server', '--protocol=lsp'],
    extensions: ['.dart'],
    installHint: 'Install Dart SDK from https://dart.dev/get-dart or Flutter SDK from https://flutter.dev'
  },
  swift: {
    name: 'SourceKit-LSP',
    command: 'sourcekit-lsp',
    args: [],
    extensions: ['.swift'],
    installHint: 'Install Swift from https://swift.org/download or via Xcode'
  },
  verilog: {
    name: 'Verible Verilog Language Server',
    command: 'verible-verilog-ls',
    args: ['--rules_config_search'],
    extensions: ['.v', '.vh', '.sv', '.svh'],
    installHint: 'Download from https://github.com/chipsalliance/verible/releases'
  }
};

/**
 * Check if a command exists in PATH
 */
export function commandExists(command: string): boolean {
  if (isAbsolute(command)) return existsSync(command);
  const checkCommand = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(checkCommand, [command], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Get the LSP server config for a file based on its extension.
 * When workspaceRoot is provided, TypeScript files prefer a project-local
 * native TypeScript 7 language server (`tsc --lsp --stdio`) when available.
 */
export function getServerForFile(filePath: string, workspaceRoot?: string): LspServerConfig | null {
  const ext = extname(filePath).toLowerCase();

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

/**
 * Get all available servers (installed and not installed)
 */
export function getAllServers(): Array<LspServerConfig & { installed: boolean }> {
  return Object.values(LSP_SERVERS).map(config => ({
    ...config,
    installed: commandExists(config.command)
  }));
}

/**
 * Get the appropriate server for a language
 */
export function getServerForLanguage(language: string): LspServerConfig | null {
  // Map common language names to server keys
  const langMap: Record<string, string> = {
    'javascript': 'typescript',
    'typescript': 'typescript',
    'tsx': 'typescript',
    'jsx': 'typescript',
    'python': 'python',
    'rust': 'rust',
    'go': 'go',
    'golang': 'go',
    'c': 'c',
    'cpp': 'c',
    'c++': 'c',
    'java': 'java',
    'json': 'json',
    'html': 'html',
    'css': 'css',
    'scss': 'css',
    'less': 'css',
    'vue': 'vue',
    'yaml': 'yaml',
    'toml': 'toml',
    'php': 'php',
    'phtml': 'php',
    'ruby': 'ruby',
    'rb': 'ruby',
    'rake': 'ruby',
    'gemspec': 'ruby',
    'erb': 'ruby',
    'lua': 'lua',
    'kotlin': 'kotlin',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'elixir': 'elixir',
    'ex': 'elixir',
    'exs': 'elixir',
    'heex': 'elixir',
    'eex': 'elixir',
    'csharp': 'csharp',
    'c#': 'csharp',
    'cs': 'csharp',
    'dart': 'dart',
    'flutter': 'dart',
    'swift': 'swift',
    'verilog': 'verilog',
    'systemverilog': 'verilog',
    'sv': 'verilog',
    'v': 'verilog'
  };

  const serverKey = langMap[language.toLowerCase()];
  if (serverKey && LSP_SERVERS[serverKey]) {
    return LSP_SERVERS[serverKey];
  }

  return null;
}
