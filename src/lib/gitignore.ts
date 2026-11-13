/** .gitignore templates for common languages, tools and operating systems. */

export interface IgnoreTemplate {
  readonly id: string;
  readonly label: string;
  readonly group: 'Languages' | 'Frameworks and engines' | 'Editors' | 'Operating systems' | 'Tools';
  readonly lines: readonly string[];
}

export const GITIGNORE_TEMPLATES: readonly IgnoreTemplate[] = [
  {
    id: 'node',
    label: 'Node.js',
    group: 'Languages',
    lines: [
      'node_modules/',
      'npm-debug.log*',
      'yarn-debug.log*',
      'yarn-error.log*',
      'pnpm-debug.log*',
      '.pnpm-store/',
      '.npm/',
      '.yarn/*',
      '!.yarn/releases',
      '!.yarn/plugins',
      '*.tsbuildinfo',
      '.eslintcache',
      'coverage/',
      '.nyc_output/',
      '.env',
      '.env.*',
      '!.env.example',
    ],
  },
  {
    id: 'python',
    label: 'Python',
    group: 'Languages',
    lines: [
      '__pycache__/',
      '*.py[cod]',
      '*.so',
      '.Python',
      'build/',
      'dist/',
      '*.egg-info/',
      '.eggs/',
      'pip-wheel-metadata/',
      '.venv/',
      'venv/',
      'env/',
      '.tox/',
      '.nox/',
      '.pytest_cache/',
      '.mypy_cache/',
      '.ruff_cache/',
      '.coverage',
      'htmlcov/',
      '.ipynb_checkpoints/',
      '.env',
    ],
  },
  { id: 'rust', label: 'Rust', group: 'Languages', lines: ['target/', '**/*.rs.bk', '# Keep Cargo.lock for applications; ignore it only for libraries.', '# Cargo.lock'] },
  { id: 'go', label: 'Go', group: 'Languages', lines: ['/bin/', '*.exe', '*.exe~', '*.dll', '*.so', '*.dylib', '*.test', '*.out', 'coverage.*', 'go.work', 'go.work.sum', 'vendor/'] },
  {
    id: 'java',
    label: 'Java / Kotlin',
    group: 'Languages',
    lines: ['*.class', '*.jar', '*.war', '*.ear', '*.log', 'hs_err_pid*', 'target/', 'build/', '.gradle/', '!gradle/wrapper/gradle-wrapper.jar', 'out/', '.kotlin/'],
  },
  {
    id: 'dotnet',
    label: '.NET / C#',
    group: 'Languages',
    lines: ['bin/', 'obj/', '*.user', '*.suo', '*.userprefs', '.vs/', 'packages/', '*.nupkg', 'TestResults/', 'project.lock.json', 'artifacts/'],
  },
  {
    id: 'c',
    label: 'C / C++',
    group: 'Languages',
    lines: [
      '*.o',
      '*.obj',
      '*.a',
      '*.lib',
      '*.so',
      '*.so.*',
      '*.dylib',
      '*.dll',
      '*.exe',
      '*.out',
      '*.app',
      'build/',
      'cmake-build-*/',
      'CMakeCache.txt',
      'CMakeFiles/',
      'compile_commands.json',
      '.cache/',
    ],
  },
  { id: 'php', label: 'PHP / Composer', group: 'Languages', lines: ['vendor/', 'composer.phar', '.phpunit.result.cache', '.php-cs-fixer.cache', '.env'] },
  { id: 'ruby', label: 'Ruby', group: 'Languages', lines: ['*.gem', '.bundle/', 'vendor/bundle/', 'log/', 'tmp/', 'coverage/', '.byebug_history'] },
  {
    id: 'dart',
    label: 'Dart / Flutter',
    group: 'Languages',
    lines: ['.dart_tool/', '.packages', 'build/', '.flutter-plugins', '.flutter-plugins-dependencies', '*.iml', 'ios/Pods/', 'android/.gradle/', 'android/local.properties'],
  },
  {
    id: 'latex',
    label: 'LaTeX',
    group: 'Languages',
    lines: ['*.aux', '*.bbl', '*.blg', '*.fdb_latexmk', '*.fls', '*.log', '*.out', '*.synctex.gz', '*.toc', '*.lof', '*.lot', '*.nav', '*.snm', '*.vrb'],
  },
  { id: 'vite', label: 'Vite / front-end build', group: 'Frameworks and engines', lines: ['dist/', 'dist-ssr/', '*.local', '.vite/', 'stats.html'] },
  { id: 'nextjs', label: 'Next.js', group: 'Frameworks and engines', lines: ['.next/', 'out/', 'next-env.d.ts', '.vercel/'] },
  { id: 'tauri', label: 'Tauri', group: 'Frameworks and engines', lines: ['src-tauri/target/', 'src-tauri/gen/schemas/'] },
  { id: 'electron', label: 'Electron', group: 'Frameworks and engines', lines: ['out/', 'release/', 'dist_electron/'] },
  { id: 'django', label: 'Django', group: 'Frameworks and engines', lines: ['*.log', 'local_settings.py', 'db.sqlite3', 'db.sqlite3-journal', 'media/', 'staticfiles/'] },
  { id: 'godot', label: 'Godot 4', group: 'Frameworks and engines', lines: ['.godot/', '/android/', 'export.cfg', 'export_credentials.cfg', '*.translation', 'mono_crash.*.json'] },
  {
    id: 'unity',
    label: 'Unity',
    group: 'Frameworks and engines',
    lines: [
      '/[Ll]ibrary/',
      '/[Tt]emp/',
      '/[Oo]bj/',
      '/[Bb]uild/',
      '/[Bb]uilds/',
      '/[Ll]ogs/',
      '/[Uu]ser[Ss]ettings/',
      '/[Mm]emoryCaptures/',
      '*.csproj',
      '*.sln',
      '*.pidb',
      '*.booproj',
      '*.apk',
      '*.aab',
      '*.unitypackage',
      'crashlytics-build.properties',
    ],
  },
  {
    id: 'unreal',
    label: 'Unreal Engine',
    group: 'Frameworks and engines',
    lines: ['Binaries/', 'DerivedDataCache/', 'Intermediate/', 'Saved/', '.vs/', '*.VC.db', '*.opensdf', '*.sdf', '*.sln', '*.suo'],
  },
  {
    id: 'android',
    label: 'Android',
    group: 'Frameworks and engines',
    lines: ['*.apk', '*.aab', '*.ap_', '.gradle/', 'build/', 'local.properties', 'captures/', '.externalNativeBuild/', '.cxx/', '*.jks', '*.keystore'],
  },
  {
    id: 'terraform',
    label: 'Terraform',
    group: 'Tools',
    lines: [
      '.terraform/',
      '*.tfstate',
      '*.tfstate.*',
      'crash.log',
      'crash.*.log',
      '*.tfvars',
      '*.tfvars.json',
      'override.tf',
      'override.tf.json',
      '*_override.tf',
      '*_override.tf.json',
      '.terraformrc',
      'terraform.rc',
    ],
  },
  { id: 'docker', label: 'Docker', group: 'Tools', lines: ['.docker/', 'docker-compose.override.yml', '*.env.local'] },
  { id: 'logs', label: 'Logs and temporary files', group: 'Tools', lines: ['logs/', '*.log', '*.tmp', '*.temp', '*.bak', '*.swp', '*.pid', '*.seed'] },
  {
    id: 'secrets',
    label: 'Secrets and keys',
    group: 'Tools',
    lines: ['.env', '.env.*', '!.env.example', '*.pem', '*.key', '*.p12', '*.pfx', 'id_rsa*', 'id_ed25519*', '.htpasswd', 'credentials.json', 'secrets.*'],
  },
  {
    id: 'vscode',
    label: 'Visual Studio Code',
    group: 'Editors',
    lines: ['.vscode/*', '!.vscode/settings.json', '!.vscode/tasks.json', '!.vscode/launch.json', '!.vscode/extensions.json', '*.code-workspace', '.history/'],
  },
  { id: 'jetbrains', label: 'JetBrains IDEs', group: 'Editors', lines: ['.idea/', '*.iml', '*.ipr', '*.iws', 'out/', '.fleet/'] },
  {
    id: 'vim',
    label: 'Vim / Neovim',
    group: 'Editors',
    lines: ['[._]*.s[a-v][a-z]', '[._]*.sw[a-p]', '[._]s[a-rt-v][a-z]', '[._]ss[a-gi-z]', '[._]sw[a-p]', 'Session.vim', '.netrwhist', '*~', 'tags'],
  },
  { id: 'emacs', label: 'Emacs', group: 'Editors', lines: ['*~', '\\#*\\#', '/.emacs.desktop', '/.emacs.desktop.lock', '*.elc', 'auto-save-list', '.projectile', '.dir-locals-2.el'] },
  { id: 'kate', label: 'Kate / KDevelop', group: 'Editors', lines: ['*.kate-swp', '.kdev4/', '*.kdev4'] },
  { id: 'linux', label: 'Linux', group: 'Operating systems', lines: ['*~', '.fuse_hidden*', '.directory', '.Trash-*', '.nfs*'] },
  {
    id: 'macos',
    label: 'macOS',
    group: 'Operating systems',
    lines: ['.DS_Store', '.AppleDouble', '.LSOverride', '._*', '.DocumentRevisions-V100', '.fseventsd', '.Spotlight-V100', '.TemporaryItems', '.Trashes', '.VolumeIcon.icns'],
  },
  {
    id: 'windows',
    label: 'Windows',
    group: 'Operating systems',
    lines: ['Thumbs.db', 'Thumbs.db:encryptable', 'ehthumbs.db', 'ehthumbs_vista.db', '*.stackdump', '[Dd]esktop.ini', '$RECYCLE.BIN/', '*.lnk'],
  },
];

/** Combines templates, keeping the first occurrence of each pattern. */
export function buildGitignore(ids: readonly string[], extra: string): string {
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const template of GITIGNORE_TEMPLATES) {
    if (!ids.includes(template.id)) continue;
    const lines = template.lines.filter((line) => {
      if (line.startsWith('#')) return true;
      if (seen.has(line)) return false;
      seen.add(line);
      return true;
    });
    if (lines.length > 0) sections.push(`# ${template.label}\n${lines.join('\n')}`);
  }
  const own = extra
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== '' && !seen.has(line));
  if (own.length > 0) sections.push(`# Project\n${own.join('\n')}`);
  return sections.length > 0 ? `${sections.join('\n\n')}\n` : '';
}
