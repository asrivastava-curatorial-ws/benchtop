/**
 * The Code Runner's languages and its built-in runtimes.  Built in (no
 * install, the web build included): JavaScript and TypeScript (types
 * stripped by Sucrase), Python (Pyodide, CPython in WebAssembly), Lua
 * (wasmoon) and SQL (SQLite through sql.js, or DuckDB).  Each run happens in
 * a fresh worker whose network and storage APIs are removed before the code
 * starts; a time limit stops it.  The desktop app also runs code with the
 * compilers and interpreters installed on the computer (see coderun.rs).
 */

export type LanguageId =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'c'
  | 'cpp'
  | 'java'
  | 'csharp'
  | 'go'
  | 'rust'
  | 'kotlin'
  | 'php'
  | 'ruby'
  | 'bash'
  | 'r'
  | 'lua'
  | 'perl'
  | 'swift'
  | 'dart'
  | 'sqlite'
  | 'duckdb';

export type BuiltIn = 'python' | 'javascript' | 'typescript' | 'lua' | 'sqlite' | 'duckdb';

export interface Example {
  readonly name: string;
  readonly code: string;
  readonly stdin?: string;
}

export interface Language {
  readonly id: LanguageId;
  readonly name: string;
  /** File name for saving, and the extension for opening. */
  readonly file: string;
  readonly builtIn?: BuiltIn;
  readonly builtInName?: string;
  /** Has a toolchain the desktop app can look for. */
  readonly desktop: boolean;
  readonly install?: { readonly linux: string; readonly mac: string; readonly windows: string };
  readonly examples: readonly Example[];
}

const GREET_INPUT = 'Ada\n3 4 5\n';

export const LANGUAGES: readonly Language[] = [
  {
    id: 'python',
    name: 'Python',
    file: 'main.py',
    builtIn: 'python',
    builtInName: 'Pyodide (CPython 3.14)',
    desktop: true,
    install: { linux: 'sudo apt install python3', mac: 'brew install python', windows: 'winget install Python.Python.3.13' },
    examples: [
      { name: 'Hello, World!', code: 'print("Hello, World!")\n' },
      { name: 'Read input', code: 'name = input()\nnumbers = list(map(int, input().split()))\nprint(f"Hello, {name}!")\nprint("Sum:", sum(numbers), "Largest:", max(numbers))\n', stdin: GREET_INPUT },
      {
        name: 'Primes (sieve)',
        code: 'def primes(n):\n    sieve = [True] * (n + 1)\n    sieve[0:2] = [False, False]\n    for i in range(2, int(n ** 0.5) + 1):\n        if sieve[i]:\n            sieve[i * i :: i] = [False] * len(sieve[i * i :: i])\n    return [i for i, p in enumerate(sieve) if p]\n\nprint(primes(100))\n',
      },
      {
        name: 'Classes and the standard library',
        code: 'from dataclasses import dataclass\nfrom collections import Counter\nimport statistics\n\n@dataclass\nclass Reading:\n    station: str\n    value: float\n\nreadings = [Reading("A", 21.5), Reading("B", 19.0), Reading("A", 22.1), Reading("C", 18.4)]\nprint(Counter(r.station for r in readings).most_common())\nprint("mean", round(statistics.mean(r.value for r in readings), 2))\n',
      },
    ],
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    file: 'main.js',
    builtIn: 'javascript',
    builtInName: 'Built-in JavaScript engine',
    desktop: true,
    install: { linux: 'sudo apt install nodejs', mac: 'brew install node', windows: 'winget install OpenJS.NodeJS.LTS' },
    examples: [
      { name: 'Hello, World!', code: "console.log('Hello, World!');\n" },
      {
        name: 'Read input (readline)',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: example code in another language
        code: "const readline = require('readline');\nconst rl = readline.createInterface({ input: process.stdin });\nconst lines = [];\nrl.on('line', (line) => lines.push(line));\nrl.on('close', () => {\n  const [name, numbers] = lines;\n  const values = numbers.split(' ').map(Number);\n  console.log(`Hello, ${name}!`);\n  console.log('Sum:', values.reduce((a, b) => a + b, 0), 'Largest:', Math.max(...values));\n});\n",
        stdin: GREET_INPUT,
      },
      { name: 'Read all input at once', code: "const input = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconsole.log(input.map((line) => line.toUpperCase()));\n", stdin: GREET_INPUT },
      {
        name: 'Classes, maps and async',
        code: "class Account {\n  #balance = 0;\n  constructor(owner) { this.owner = owner; }\n  deposit(amount) { this.#balance += amount; return this; }\n  get balance() { return this.#balance; }\n}\n\nconst wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));\nconst a = new Account('Ada').deposit(50).deposit(25);\nawait wait(100);\nconsole.log(a.owner, a.balance);\nconsole.log(new Map([['x', 1], ['y', 2]]), { nested: { list: [1, 2, 3] } });\n",
      },
    ],
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    file: 'main.ts',
    builtIn: 'typescript',
    builtInName: 'Built-in (types stripped, not checked)',
    desktop: true,
    install: { linux: 'Install Deno, Bun or Node.js 22.6 or later', mac: 'brew install deno', windows: 'winget install DenoLand.Deno' },
    examples: [
      { name: 'Hello, World!', code: "const greeting: string = 'Hello, World!';\nconsole.log(greeting);\n" },
      {
        name: 'Interfaces and generics',
        code: 'interface Point {\n  x: number;\n  y: number;\n}\n\nfunction largest<T>(items: T[], score: (item: T) => number): T | undefined {\n  return items.reduce<T | undefined>((best, item) => (best === undefined || score(item) > score(best) ? item : best), undefined);\n}\n\nconst points: Point[] = [{ x: 1, y: 2 }, { x: 3, y: 1 }, { x: 0, y: 5 }];\nconsole.log(largest(points, (p) => Math.hypot(p.x, p.y)));\n',
      },
      {
        name: 'Read input',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: example code in another language
        code: "const lines: string[] = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\nconst [name, numbers] = lines;\nconst values: number[] = numbers.split(' ').map(Number);\nconsole.log(`Hello, ${name}! Sum: ${values.reduce((a, b) => a + b, 0)}`);\n",
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'c',
    name: 'C',
    file: 'main.c',
    desktop: true,
    install: { linux: 'sudo apt install build-essential', mac: 'xcode-select --install', windows: 'Install MSYS2 (winget install MSYS2.MSYS2), then: pacman -S mingw-w64-ucrt-x86_64-gcc' },
    examples: [
      { name: 'Hello, World!', code: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello, World!\\n");\n    return 0;\n}\n' },
      {
        name: 'Read input',
        code: '#include <stdio.h>\n\nint main(void) {\n    char name[64];\n    int a, b, c;\n    scanf("%63s %d %d %d", name, &a, &b, &c);\n    printf("Hello, %s! Sum: %d\\n", name, a + b + c);\n    return 0;\n}\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'cpp',
    name: 'C++',
    file: 'main.cpp',
    desktop: true,
    install: { linux: 'sudo apt install build-essential', mac: 'xcode-select --install', windows: 'Install MSYS2 (winget install MSYS2.MSYS2), then: pacman -S mingw-w64-ucrt-x86_64-gcc' },
    examples: [
      { name: 'Hello, World!', code: '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}\n' },
      {
        name: 'Read input',
        code: '#include <iostream>\n#include <numeric>\n#include <string>\n#include <vector>\n\nint main() {\n    std::string name;\n    std::vector<int> v(3);\n    std::cin >> name >> v[0] >> v[1] >> v[2];\n    std::cout << "Hello, " << name << "! Sum: " << std::accumulate(v.begin(), v.end(), 0) << "\\n";\n}\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'java',
    name: 'Java',
    file: 'Main.java',
    desktop: true,
    install: { linux: 'sudo apt install default-jdk', mac: 'brew install openjdk', windows: 'winget install EclipseAdoptium.Temurin.21.JDK' },
    examples: [
      { name: 'Hello, World!', code: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}\n' },
      {
        name: 'Read input',
        code: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner in = new Scanner(System.in);\n        String name = in.next();\n        int sum = in.nextInt() + in.nextInt() + in.nextInt();\n        System.out.println("Hello, " + name + "! Sum: " + sum);\n    }\n}\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'csharp',
    name: 'C#',
    file: 'main.cs',
    desktop: true,
    install: { linux: 'Install the .NET 10 SDK (dotnet run runs a single file from .NET 10)', mac: 'brew install --cask dotnet-sdk', windows: 'winget install Microsoft.DotNet.SDK.10' },
    examples: [
      { name: 'Hello, World!', code: 'Console.WriteLine("Hello, World!");\n' },
      {
        name: 'Read input',
        code: 'var name = Console.ReadLine();\nvar numbers = Console.ReadLine()!.Split(\' \').Select(int.Parse).ToArray();\nConsole.WriteLine($"Hello, {name}! Sum: {numbers.Sum()}");\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'go',
    name: 'Go',
    file: 'main.go',
    desktop: true,
    install: { linux: 'sudo apt install golang-go', mac: 'brew install go', windows: 'winget install GoLang.Go' },
    examples: [
      { name: 'Hello, World!', code: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n' },
      {
        name: 'Read input',
        code: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar name string\n\tvar a, b, c int\n\tfmt.Scan(&name, &a, &b, &c)\n\tfmt.Printf("Hello, %s! Sum: %d\\n", name, a+b+c)\n}\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'rust',
    name: 'Rust',
    file: 'main.rs',
    desktop: true,
    install: { linux: 'sudo apt install rustc', mac: 'brew install rust', windows: 'winget install Rustlang.Rustup' },
    examples: [
      { name: 'Hello, World!', code: 'fn main() {\n    println!("Hello, World!");\n}\n' },
      {
        name: 'Read input',
        code: 'use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n    let mut words = input.split_whitespace();\n    let name = words.next().unwrap_or("");\n    let sum: i64 = words.map(|w| w.parse::<i64>().unwrap()).sum();\n    println!("Hello, {name}! Sum: {sum}");\n}\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    file: 'main.kt',
    desktop: true,
    install: {
      linux: 'sudo snap install kotlin --classic (needs a JDK)',
      mac: 'brew install kotlin',
      windows: 'Download the Kotlin compiler from kotlinlang.org and add its bin folder to PATH (needs a JDK)',
    },
    examples: [
      { name: 'Hello, World!', code: 'fun main() {\n    println("Hello, World!")\n}\n' },
      {
        name: 'Read input',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: example code in another language
        code: 'fun main() {\n    val name = readln()\n    val numbers = readln().split(" ").map { it.toInt() }\n    println("Hello, $name! Sum: ${numbers.sum()}")\n}\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'php',
    name: 'PHP',
    file: 'main.php',
    desktop: true,
    install: { linux: 'sudo apt install php-cli', mac: 'brew install php', windows: 'Download PHP from windows.php.net and add it to PATH' },
    examples: [
      { name: 'Hello, World!', code: '<?php\necho "Hello, World!\\n";\n' },
      {
        name: 'Read input',
        code: '<?php\n$name = trim(fgets(STDIN));\n$numbers = array_map(\'intval\', explode(\' \', trim(fgets(STDIN))));\necho "Hello, $name! Sum: " . array_sum($numbers) . "\\n";\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'ruby',
    name: 'Ruby',
    file: 'main.rb',
    desktop: true,
    install: { linux: 'sudo apt install ruby', mac: 'brew install ruby', windows: 'winget install RubyInstallerTeam.Ruby.3.3' },
    examples: [
      { name: 'Hello, World!', code: 'puts "Hello, World!"\n' },
      { name: 'Read input', code: 'name = gets.strip\nnumbers = gets.split.map(&:to_i)\nputs "Hello, #{name}! Sum: #{numbers.sum}"\n', stdin: GREET_INPUT },
    ],
  },
  {
    id: 'bash',
    name: 'Bash',
    file: 'main.sh',
    desktop: true,
    install: { linux: 'Already installed', mac: 'Already installed (or brew install bash for a newer one)', windows: 'Install Git for Windows (winget install Git.Git) or WSL' },
    examples: [
      { name: 'Hello, World!', code: 'echo "Hello, World!"\n' },
      { name: 'Read input', code: 'read -r name\nread -r a b c\necho "Hello, $name! Sum: $((a + b + c))"\n', stdin: GREET_INPUT },
    ],
  },
  {
    id: 'r',
    name: 'R',
    file: 'main.R',
    desktop: true,
    install: { linux: 'sudo apt install r-base', mac: 'brew install r', windows: 'winget install RProject.R' },
    examples: [
      { name: 'Hello, World!', code: 'cat("Hello, World!\\n")\n' },
      { name: 'Summary statistics', code: 'x <- c(12.1, 9.8, 15.3, 11.0, 10.4, 13.9)\nprint(summary(x))\ncat("Standard deviation:", round(sd(x), 3), "\\n")\n' },
    ],
  },
  {
    id: 'lua',
    name: 'Lua',
    file: 'main.lua',
    builtIn: 'lua',
    builtInName: 'Built-in Lua 5.4 (wasmoon)',
    desktop: true,
    install: { linux: 'sudo apt install lua5.4', mac: 'brew install lua', windows: 'winget install DEVCOM.Lua' },
    examples: [
      { name: 'Hello, World!', code: 'print("Hello, World!")\n' },
      { name: 'Read input', code: 'local name = io.read()\nlocal a, b, c = io.read("n", "n", "n")\nprint(("Hello, %s! Sum: %d"):format(name, a + b + c))\n', stdin: GREET_INPUT },
      {
        name: 'Tables and closures',
        code: 'local function counter()\n  local n = 0\n  return function() n = n + 1; return n end\nend\n\nlocal next = counter()\nnext(); next()\nlocal fruits = { "fig", "apple", "kiwi" }\ntable.sort(fruits)\nprint(table.concat(fruits, ", "), next())\n',
      },
    ],
  },
  {
    id: 'perl',
    name: 'Perl',
    file: 'main.pl',
    desktop: true,
    install: { linux: 'Already installed (or sudo apt install perl)', mac: 'Already installed', windows: 'winget install StrawberryPerl.StrawberryPerl' },
    examples: [
      { name: 'Hello, World!', code: 'print "Hello, World!\\n";\n' },
      { name: 'Read input', code: 'chomp(my $name = <STDIN>);\nmy @numbers = split / /, <STDIN>;\nmy $sum = 0;\n$sum += $_ for @numbers;\nprint "Hello, $name! Sum: $sum\\n";\n', stdin: GREET_INPUT },
    ],
  },
  {
    id: 'swift',
    name: 'Swift',
    file: 'main.swift',
    desktop: true,
    install: { linux: 'Install the Swift toolchain from swift.org', mac: 'xcode-select --install', windows: 'winget install Swift.Toolchain' },
    examples: [
      { name: 'Hello, World!', code: 'print("Hello, World!")\n' },
      {
        name: 'Read input',
        code: 'let name = readLine() ?? ""\nlet numbers = (readLine() ?? "").split(separator: " ").compactMap { Int($0) }\nprint("Hello, \\(name)! Sum: \\(numbers.reduce(0, +))")\n',
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'dart',
    name: 'Dart',
    file: 'main.dart',
    desktop: true,
    install: {
      linux: 'Install the Dart SDK from dart.dev',
      mac: 'brew tap dart-lang/dart && brew install dart',
      windows: 'Install the Dart SDK from dart.dev (or with Chocolatey: choco install dart-sdk)',
    },
    examples: [
      { name: 'Hello, World!', code: "void main() {\n  print('Hello, World!');\n}\n" },
      {
        name: 'Read input',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: example code in another language
        code: "import 'dart:io';\n\nvoid main() {\n  final name = stdin.readLineSync();\n  final numbers = stdin.readLineSync()!.split(' ').map(int.parse);\n  print('Hello, $name! Sum: ${numbers.reduce((a, b) => a + b)}');\n}\n",
        stdin: GREET_INPUT,
      },
    ],
  },
  {
    id: 'sqlite',
    name: 'SQL (SQLite)',
    file: 'query.sql',
    builtIn: 'sqlite',
    builtInName: 'Built-in SQLite (sql.js)',
    desktop: false,
    examples: [
      {
        name: 'Tables and a join',
        code: "CREATE TABLE staff (id INTEGER PRIMARY KEY, name TEXT, team TEXT);\nCREATE TABLE hours (staff_id INTEGER, day TEXT, hours REAL);\n\nINSERT INTO staff (name, team) VALUES ('Asha', 'Exhibits'), ('Ravi', 'Workshop'), ('Meera', 'Exhibits');\nINSERT INTO hours VALUES (1, 'Mon', 7.5), (1, 'Tue', 8), (2, 'Mon', 6), (3, 'Mon', 9), (3, 'Tue', 4.5);\n\nSELECT s.team, s.name, SUM(h.hours) AS total\nFROM staff s JOIN hours h ON h.staff_id = s.id\nGROUP BY s.id\nORDER BY total DESC;\n",
      },
      {
        name: 'Window functions',
        code: 'WITH sales(month, amount) AS (VALUES (1, 120), (2, 90), (3, 150), (4, 130))\nSELECT month, amount, SUM(amount) OVER (ORDER BY month) AS running_total,\n       amount - LAG(amount) OVER (ORDER BY month) AS change\nFROM sales;\n',
      },
    ],
  },
  {
    id: 'duckdb',
    name: 'SQL (DuckDB)',
    file: 'query.sql',
    builtIn: 'duckdb',
    builtInName: 'Built-in DuckDB',
    desktop: false,
    examples: [
      {
        name: 'Generate and summarise',
        code: 'CREATE TABLE readings AS\n  SELECT range AS minute, 20 + 5 * sin(range / 10.0) + random() AS celsius\n  FROM range(0, 120);\n\nSELECT (minute // 30) * 30 AS from_minute, round(avg(celsius), 2) AS mean, round(max(celsius), 2) AS peak\nFROM readings\nGROUP BY 1\nORDER BY 1;\n',
      },
      {
        name: 'Lists and structs',
        code: "SELECT name, list_sum(scores) AS total, {'best': list_max(scores), 'count': len(scores)} AS summary\nFROM (VALUES ('Asha', [7, 9, 8]), ('Ravi', [6, 10])) t(name, scores);\n",
      },
    ],
  },
];

export const languageById = (id: string): Language | undefined => LANGUAGES.find((l) => l.id === id);

/* --------------------------------------------------------------- workers -- */

/** APIs a run may not use: the network, storage, and ways to start more code. */
const BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'importScripts',
  'Worker',
  'SharedWorker',
  'RTCPeerConnection',
  'open',
  'close',
  'requestFileSystem',
  'webkitRequestFileSystem',
];

/** Shared start of every worker: posting output, and removing the blocked APIs (after any runtime has loaded). */
const PRELUDE = `var __post = self.postMessage.bind(self);
var __out = function (stream, text) { __post({ type: 'out', stream: stream, text: String(text) }); };
var __strip = function (target, name) { try { for (var o = target; o; o = Object.getPrototypeOf(o)) if (Object.prototype.hasOwnProperty.call(o, name)) delete o[name]; } catch (e) {} };
var __lockDown = function () {
  ${JSON.stringify(BLOCKED)}.forEach(function (name) { __strip(self, name); });
  if (self.navigator) ['storage', 'locks', 'serviceWorker', 'usb', 'serial', 'hid', 'bluetooth'].forEach(function (name) { __strip(self.navigator, name); });
};
var __stdinLines = function (text) { var lines = text.split(/\\r?\\n/); if (lines.length && lines[lines.length - 1] === '') lines.pop(); return lines; };
`;

/** Node's console formatting, roughly: strings as they are, everything else as util.inspect shows it. */
const INSPECT = `var __inspect = function (v, depth, seen) {
  depth = depth || 0; seen = seen || [];
  if (typeof v === 'string') return depth ? "'" + v.replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'") + "'" : v;
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'bigint') return v + 'n';
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'symbol') return String(v);
  if (typeof v === 'function') return /^class[\\s{]/.test(Function.prototype.toString.call(v)) ? '[class ' + (v.name || '(anonymous)') + ']' : '[Function: ' + (v.name || '(anonymous)') + ']';
  if (v instanceof Error) return v.stack ? String(v.stack) : String(v);
  if (seen.indexOf(v) >= 0) return '[Circular *1]';
  if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toISOString();
  if (v instanceof RegExp) return String(v);
  if (depth > 2) return Array.isArray(v) ? '[Array]' : '[Object]';
  seen = seen.concat([v]);
  var join = function (items, open, close) { if (!items.length) return open + close; var flat = open + ' ' + items.join(', ') + ' ' + close; return flat.length <= 72 ? flat : open + '\\n' + items.map(function (s) { return '  ' + s.replace(/\\n/g, '\\n  '); }).join(',\\n') + '\\n' + close; };
  if (Array.isArray(v)) { var items = v.slice(0, 100).map(function (x) { return __inspect(x, depth + 1, seen); }); if (v.length > 100) items.push('... ' + (v.length - 100) + ' more items'); return join(items, '[', ']'); }
  if (ArrayBuffer.isView(v)) return v.constructor.name + '(' + v.length + ') ' + join(Array.prototype.slice.call(v, 0, 100).map(String), '[', ']');
  if (v instanceof Map) return 'Map(' + v.size + ') ' + join(Array.from(v).map(function (e) { return __inspect(e[0], depth + 1, seen) + ' => ' + __inspect(e[1], depth + 1, seen); }), '{', '}');
  if (v instanceof Set) return 'Set(' + v.size + ') ' + join(Array.from(v).map(function (x) { return __inspect(x, depth + 1, seen); }), '{', '}');
  if (typeof v.then === 'function') return 'Promise { <pending> }';
  var name = v.constructor && v.constructor !== Object && v.constructor.name ? v.constructor.name + ' ' : '';
  var keys = Object.keys(v);
  return name + join(keys.map(function (k) { return (/^[A-Za-z_$][\\w$]*$/.test(k) ? k : "'" + k + "'") + ': ' + __inspect(v[k], depth + 1, seen); }), '{', '}');
};
var __format = function (args) {
  args = Array.prototype.slice.call(args);
  var first = args[0];
  if (typeof first === 'string' && /%[sdifjoOc%]/.test(first)) {
    args.shift();
    first = first.replace(/%([sdifjoOc%])/g, function (m, f) {
      if (f === '%') return '%';
      if (!args.length) return m;
      var a = args.shift();
      if (f === 's') return typeof a === 'string' ? a : __inspect(a, 1);
      if (f === 'd' || f === 'i') return String(f === 'i' ? parseInt(a, 10) : Number(a));
      if (f === 'f') return String(parseFloat(a));
      if (f === 'j') { try { return JSON.stringify(a); } catch (e) { return '[Circular]'; } }
      if (f === 'c') return '';
      return __inspect(a, 1);
    });
    args.unshift(first);
  }
  return args.map(function (a) { return __inspect(a, 0); }).join(' ');
};
`;

/**
 * The whole worker script for JavaScript: no network or storage, Node-like
 * console, require('readline'), require('fs').readFileSync(0), process.stdin
 * and process.argv, prompt(), and a finish once no timers are left.  The
 * code is wrapped so top-level await works; `offset` is the number of
 * script lines before its first line.
 */
export function jsWorker(code: string, stdin: string, args: readonly string[] = []): { script: string; offset: number } {
  const head = `${PRELUDE}${INSPECT}
__lockDown();
var __stdinText = ${JSON.stringify(stdin)};
var __lines = __stdinLines(__stdinText);
var __next = 0;
var __timers = new Set();
var __mainDone = false;
var __finished = false;
var __setTimeout = self.setTimeout.bind(self), __clearTimeout = self.clearTimeout.bind(self);
var __setInterval = self.setInterval.bind(self), __clearInterval = self.clearInterval.bind(self);
var __finish = function (code) { if (__finished) return; __finished = true; __post({ type: 'done', exitCode: code }); };
var __where = function (stack) { var m = /blob:[^\\s)]*:(\\d+):(\\d+)/.exec(String(stack || '')); return m ? Math.max(1, Number(m[1]) - __FIRST_OFFSET__) : 0; };
var __fail = function (error) {
  if (error && error.__exit !== undefined) { __finish(error.__exit); return; }
  var text = error && error.stack ? String(error.stack).split('\\n').filter(function (l) { return !/^\\s+at (__|self\\.|Object\\.(set|clear))|<anonymous>/.test(l); }).join('\\n').replace(/blob:[^\\s)]*:(\\d+):(\\d+)/g, function (m, l, c) { return 'main.js:' + Math.max(1, Number(l) - __FIRST_OFFSET__) + ':' + c; }) : String(error);
  __post({ type: 'error', text: text, line: __where(error && error.stack) });
  __finish(1);
};
var __check = function () { __setTimeout(function () { if (__mainDone && __timers.size === 0) __finish(process.exitCode || 0); }, 0); };
self.setTimeout = function (fn, ms) { var rest = Array.prototype.slice.call(arguments, 2); if (typeof fn !== 'function') throw new TypeError('setTimeout needs a function'); var id = __setTimeout(function () { __timers.delete(id); try { fn.apply(null, rest); } catch (e) { __fail(e); } __check(); }, ms); __timers.add(id); return id; };
self.clearTimeout = function (id) { __timers.delete(id); __clearTimeout(id); __check(); };
self.setInterval = function (fn, ms) { var rest = Array.prototype.slice.call(arguments, 2); if (typeof fn !== 'function') throw new TypeError('setInterval needs a function'); var id = __setInterval(function () { try { fn.apply(null, rest); } catch (e) { __fail(e); } }, ms); __timers.add(id); return id; };
self.clearInterval = function (id) { __timers.delete(id); __clearInterval(id); __check(); };
self.setImmediate = function (fn) { return self.setTimeout.apply(null, [fn, 0].concat(Array.prototype.slice.call(arguments, 1))); };
['log', 'info', 'debug', 'trace'].forEach(function (k) { console[k] = function () { __out('stdout', __format(arguments) + '\\n'); }; });
['warn', 'error'].forEach(function (k) { console[k] = function () { __out('stderr', __format(arguments) + '\\n'); }; });
console.table = function (data) { __out('stdout', __inspect(data) + '\\n'); };
console.dir = function (v) { __out('stdout', __inspect(v) + '\\n'); };
var __bytes = function () { return new TextEncoder().encode(__stdinText); };
var __listeners = {};
self.process = {
  argv: ['node', 'main.js'].concat(${JSON.stringify(args)}), env: {}, exitCode: 0, platform: 'browser', version: 'v22.0.0', versions: {},
  exit: function (code) { throw { __exit: code === undefined ? process.exitCode || 0 : code }; },
  hrtime: Object.assign(function () { var t = performance.now(); return [Math.floor(t / 1000), Math.round((t % 1000) * 1e6)]; }, { bigint: function () { return BigInt(Math.round(performance.now() * 1e6)); } }),
  nextTick: function (fn) { var rest = Array.prototype.slice.call(arguments, 1); queueMicrotask(function () { fn.apply(null, rest); }); },
  memoryUsage: function () { return { rss: 0, heapTotal: 0, heapUsed: 0 }; },
  cwd: function () { return '/'; },
  stdout: { write: function (s) { __out('stdout', s); return true; }, isTTY: false },
  stderr: { write: function (s) { __out('stderr', s); return true; }, isTTY: false },
  stdin: {
    isTTY: false,
    setEncoding: function () { return this; }, resume: function () { return this; }, pause: function () { return this; },
    on: function (event, fn) {
      if (event === 'data') self.setTimeout(function () { fn(__stdinText); });
      if (event === 'end' || event === 'close') self.setTimeout(function () { self.setTimeout(fn); });
      if (event === 'readable') self.setTimeout(fn);
      return this;
    },
    once: function (event, fn) { return this.on(event, fn); },
    read: function () { var t = __stdinText; __stdinText = ''; return t || null; },
  },
};
var __readline = {
  createInterface: function () {
    var handlers = { line: [], close: [] };
    var closed = false;
    var rl = {
      on: function (event, fn) { (handlers[event] = handlers[event] || []).push(fn); return rl; },
      once: function (event, fn) { return rl.on(event, fn); },
      question: function (q, fn) { __out('stdout', q); var line = __next < __lines.length ? __lines[__next++] : ''; self.setTimeout(function () { fn(line); }); },
      close: function () { if (closed) return; closed = true; handlers.close.forEach(function (fn) { fn(); }); },
      setPrompt: function () {}, prompt: function () {}, write: function (s) { __out('stdout', s); },
    };
    rl[Symbol.asyncIterator] = function () { return { next: function () { return Promise.resolve(__next < __lines.length ? { value: __lines[__next++], done: false } : { value: undefined, done: true }); } }; };
    self.setTimeout(function feed() {
      if (closed) return;
      if (handlers.line.length && __next < __lines.length) { var line = __lines[__next++]; handlers.line.forEach(function (fn) { fn(line); }); self.setTimeout(feed); return; }
      if (handlers.line.length || handlers.close.length) rl.close();
    });
    return rl;
  },
};
self.require = function (name) {
  name = String(name).replace(/^node:/, '');
  if (name === 'readline') return __readline;
  if (name === 'fs') return { readFileSync: function (path, enc) { if (path === 0 || path === '/dev/stdin') { var t = __stdinText; return enc ? t : Object.assign(__bytes(), { toString: function () { return t; } }); } throw new Error('There are no files here: only standard input can be read, with fs.readFileSync(0).'); } };
  if (name === 'util') return { inspect: function (v) { return __inspect(v, 0); }, format: function () { return __format(arguments); } };
  if (name === 'assert') { var ok = function (v, m) { if (!v) throw new Error(m || 'Assertion failed'); }; ok.ok = ok; ok.equal = function (a, b, m) { ok(a == b, m || a + ' == ' + b); }; ok.strictEqual = function (a, b, m) { ok(a === b, m || a + ' === ' + b); }; ok.deepStrictEqual = function (a, b, m) { ok(JSON.stringify(a) === JSON.stringify(b), m || 'Values are not deeply equal'); }; return ok; }
  if (name === 'process') return process;
  throw new Error("Cannot find module '" + name + "': the built-in runner has readline, fs (standard input only), util and assert.");
};
self.module = { exports: {} };
self.exports = self.module.exports;
self.prompt = function (q) { if (q) __out('stdout', q); return __next < __lines.length ? __lines[__next++] : null; };
self.addEventListener('error', function (event) { event.preventDefault(); __fail(event.error || new Error(event.message)); });
self.addEventListener('unhandledrejection', function (event) { event.preventDefault(); __fail(event.reason); });
`;
  // ES module syntax becomes plain script: exports are dropped, imports explained.
  if (/^\s*import\s[\s\S]*?from\s|^\s*import\s*['"]/m.test(code))
    throw new Error('import statements need a module system: in the built-in runner use require(), or run the file with Node in the desktop app.');
  const body = code.replace(/^(\s*)export\s+default\s+/gm, '$1module.exports.default = ').replace(/^(\s*)export\s+(?=(async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '$1');
  const offset = (head.match(/\n/g) ?? []).length + 1;
  const script = `${head.replaceAll('__FIRST_OFFSET__', String(offset))}(async function () {\n${body}\n})().then(function () { __mainDone = true; __check(); }, __fail);\n`;
  return { script, offset };
}

/** TypeScript to JavaScript by removing the types (Sucrase); nothing is type-checked. */
export async function stripTypes(code: string): Promise<string> {
  const { transform } = await import('sucrase');
  try {
    return transform(code, { transforms: ['typescript'], disableESTransforms: true, keepUnusedImports: false }).code;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`The TypeScript could not be read: ${message.replace(/\s*\(\d+:\d+\)$/, '')}`);
  }
}

/** Python: Pyodide loads once, then runs each program in a fresh namespace with stdin as its input. */
export function pythonWorker(base: string): string {
  return `${PRELUDE}
importScripts(${JSON.stringify(`${base}pyodide/pyodide.js`)});
var __decoder = new TextDecoder();
var __errDecoder = new TextDecoder();
var __lines = [];
var __py = null;
loadPyodide({ indexURL: ${JSON.stringify(`${base}pyodide/`)}, fullStdLib: false }).then(function (py) {
  __py = py;
  py.setStdout({ write: function (buffer) { __out('stdout', __decoder.decode(buffer, { stream: true })); return buffer.length; } });
  py.setStderr({ write: function (buffer) { __out('stderr', __errDecoder.decode(buffer, { stream: true })); return buffer.length; } });
  py.setStdin({ stdin: function () { return __lines.length ? __lines.shift() : undefined; }, autoEOF: false });
  py.runPython('import sys, traceback');
  __lockDown();
  __post({ type: 'ready', version: py.runPython('import sys; sys.version.split()[0]') });
}, function (error) { __post({ type: 'error', text: 'Python could not start: ' + (error && error.message || error) }); __post({ type: 'done', exitCode: 1 }); });
self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'run' || !__py) return;
  __lines = __stdinLines(String(data.stdin || ''));
  __py.globals.set('__benchtop_code', String(data.code || ''));
  __py.globals.set('__benchtop_args', __py.toPy(['main.py'].concat(data.args || [])));
  var exitCode = __py.runPython([
    'def __benchtop_run():',
    '    import sys, traceback',
    '    sys.argv = list(__benchtop_args)',
    '    namespace = {"__name__": "__main__", "__file__": "main.py"}',
    '    try:',
    '        exec(compile(__benchtop_code, "main.py", "exec"), namespace)',
    '        return 0',
    '    except SystemExit as e:',
    '        if e.code is None: return 0',
    '        if isinstance(e.code, int): return e.code',
    '        print(e.code, file=sys.stderr)',
    '        return 1',
    '    except BaseException:',
    '        kind, value, tb = sys.exc_info()',
    '        traceback.print_exception(kind, value, tb.tb_next if tb else tb)',
    '        return 1',
    '    finally:',
    '        sys.stdout.flush(); sys.stderr.flush()',
    '__benchtop_run()',
  ].join('\\n'));
  __post({ type: 'done', exitCode: Number(exitCode) || 0 });
};
`;
}

/** Lua 5.4 (wasmoon): print, io.write and io.read go to the output and come from stdin. */
export function luaWorker(base: string, code: string, stdin: string): string {
  return `${PRELUDE}
importScripts(${JSON.stringify(`${base}lua/wasmoon.js`)});
var __text = ${JSON.stringify(stdin)};
var __pos = 0;
var __readline = function () { if (__pos >= __text.length) return undefined; var end = __text.indexOf('\\n', __pos); var line = end < 0 ? __text.slice(__pos) : __text.slice(__pos, end); __pos = end < 0 ? __text.length : end + 1; return line.replace(/\\r$/, ''); };
var __readnumber = function () { var m = /^\\s*([-+]?(?:0[xX][0-9a-fA-F]+|\\d*\\.?\\d+(?:[eE][-+]?\\d+)?))/.exec(__text.slice(__pos)); if (!m) return undefined; __pos += m[0].length; return Number(m[1]); };
var __readall = function () { var t = __text.slice(__pos); __pos = __text.length; return t; };
var __readchars = function (n) { if (__pos >= __text.length) return undefined; var t = __text.slice(__pos, __pos + n); __pos += t.length; return t; };
new wasmoon.LuaFactory(${JSON.stringify(`${base}lua/glue.wasm`)}).createEngine({ injectObjects: false, enableProxy: false }).then(async function (lua) {
  __lockDown();
  lua.global.set('__write', function (s) { __out('stdout', s); });
  lua.global.set('__ewrite', function (s) { __out('stderr', s); });
  lua.global.set('__readline', __readline);
  lua.global.set('__readnumber', __readnumber);
  lua.global.set('__readall', __readall);
  lua.global.set('__readchars', __readchars);
  await lua.doString([
    'local w, ew, rl, rn, ra, rc = __write, __ewrite, __readline, __readnumber, __readall, __readchars',
    'print = function(...) local n = select("#", ...) local t = {} for i = 1, n do t[i] = tostring((select(i, ...))) end w(table.concat(t, "\\\\t") .. "\\\\n") end',
    'local function one(f) f = f or "l" if type(f) == "number" then return rc(f) end f = f:gsub("^%*", "") if f:sub(1, 1) == "n" then return rn() elseif f:sub(1, 1) == "a" then return ra() elseif f:sub(1, 1) == "L" then local l = rl() return l and (l .. "\\\\n") else return rl() end end',
    'io.read = function(...) local n = select("#", ...) if n == 0 then return rl() end local out = {} for i = 1, n do out[i] = one((select(i, ...))) end return table.unpack(out, 1, n) end',
    'io.write = function(...) for i = 1, select("#", ...) do w(tostring((select(i, ...)))) end return io end',
    'io.lines = function() return function() return rl() end end',
    'io.stdout = { write = function(self, ...) for i = 1, select("#", ...) do w(tostring((select(i, ...)))) end return self end }',
    'io.stderr = { write = function(self, ...) for i = 1, select("#", ...) do ew(tostring((select(i, ...)))) end return self end }',
    'io.stdin = { read = function(self, ...) return io.read(...) end, lines = function() return io.lines() end }',
    'os.exit = function(c) error({ __exit = c == true and 0 or (c or 0) }, 0) end',
    '__write, __ewrite, __readline, __readnumber, __readall, __readchars = nil',
  ].join('\\n'));
  try {
    await lua.doString(${JSON.stringify(code)});
    __post({ type: 'done', exitCode: 0 });
  } catch (error) {
    var text = String(error && error.message || error);
    var exit = /^\\[object Object\\]|__exit/.test(text) ? 0 : null;
    if (exit === null) { __post({ type: 'error', text: text.replace(/\\[string "[^"]*"\\]/g, 'main.lua'), line: Number((/\\]:(\\d+):/.exec(text) || [])[1]) || 0 }); __post({ type: 'done', exitCode: 1 }); }
    else __post({ type: 'done', exitCode: 0 });
  }
}, function (error) { __post({ type: 'error', text: 'Lua could not start: ' + (error && error.message || error) }); __post({ type: 'done', exitCode: 1 }); });
`;
}

/** SQLite (sql.js): each statement's rows are printed as a table. */
export function sqliteWorker(base: string, code: string): string {
  return `${PRELUDE}
importScripts(${JSON.stringify(`${base}sqljs/sql-wasm.js`)});
initSqlJs({ locateFile: function (name) { return ${JSON.stringify(`${base}sqljs/`)} + name; } }).then(function (SQL) {
  __lockDown();
  var db = new SQL.Database();
  try {
    var results = db.exec(${JSON.stringify(code)});
    results.forEach(function (r) { __post({ type: 'table', columns: r.columns, rows: r.values.map(function (row) { return row.map(function (v) { return v === null ? null : v instanceof Uint8Array ? '<' + v.length + ' bytes>' : String(v); }); }) }); });
    if (!results.length) __out('stdout', 'Done. (' + db.getRowsModified() + ' rows changed by the last statement.)\\n');
    __post({ type: 'done', exitCode: 0 });
  } catch (error) {
    __post({ type: 'error', text: String(error && error.message || error) });
    __post({ type: 'done', exitCode: 1 });
  }
}, function (error) { __post({ type: 'error', text: 'SQLite could not start: ' + (error && error.message || error) }); __post({ type: 'done', exitCode: 1 }); });
`;
}

/* ------------------------------------------------------------------ output -- */

/** Result rows as a text table with box-drawing lines, as sqlite3 and duckdb print them. */
export function textTable(columns: readonly string[], rows: readonly (readonly (string | null)[])[], maxRows = 1000): string {
  const shown = rows.slice(0, maxRows).map((r) => r.map((v) => (v === null ? 'NULL' : v.replace(/\n/g, '↵'))));
  const width = (s: string) => [...s].length;
  const widths = columns.map((c, i) => Math.min(60, Math.max(width(c), ...shown.map((r) => width(r[i] ?? '')))));
  const cut = (s: string, w: number) => (width(s) > w ? `${[...s].slice(0, w - 1).join('')}…` : s);
  const numeric = columns.map((_, i) => shown.length > 0 && shown.every((r) => r[i] === 'NULL' || /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(r[i] ?? '')));
  const pad = (s: string, w: number, right: boolean) => (right ? ' '.repeat(Math.max(0, w - width(s))) + s : s + ' '.repeat(Math.max(0, w - width(s))));
  const line = (l: string, m: string, r: string) => `${l}${widths.map((w) => '─'.repeat(w + 2)).join(m)}${r}`;
  const row = (cells: readonly string[], head = false) => `│${cells.map((c, i) => ` ${pad(cut(c, widths[i] as number), widths[i] as number, !head && (numeric[i] ?? false))} `).join('│')}│`;
  const out = [line('┌', '┬', '┐'), row(columns, true), line('├', '┼', '┤'), ...shown.map((r) => row(r.map((v) => v ?? ''))), line('└', '┴', '┘')];
  out.push(`(${rows.length} row${rows.length === 1 ? '' : 's'}${rows.length > maxRows ? `, the first ${maxRows} shown` : ''})`);
  return `${out.join('\n')}\n`;
}

/** Splits an SQL script into statements, minding quotes, comments and dollar-quoted text. */
export function splitSql(script: string): string[] {
  const out: string[] = [];
  let current = '';
  let i = 0;
  while (i < script.length) {
    const ch = script[i] as string;
    const two = script.slice(i, i + 2);
    if (two === '--') {
      const end = script.indexOf('\n', i);
      const stop = end < 0 ? script.length : end;
      current += script.slice(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = script.indexOf('*/', i + 2);
      const stop = end < 0 ? script.length : end + 2;
      current += script.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < script.length) {
        if (script[j] === ch) {
          if (script[j + 1] === ch) j += 2;
          else break;
        } else j++;
      }
      current += script.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(script.slice(i))?.[0];
      if (tag) {
        const end = script.indexOf(tag, i + tag.length);
        const stop = end < 0 ? script.length : end + tag.length;
        current += script.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (ch === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim()) out.push(current.trim());
  return out;
}

/** Where the built-in runtimes are served from, beside the app. */
export const runtimeBase = (): string => new URL('coderun/', document.baseURI).href;
