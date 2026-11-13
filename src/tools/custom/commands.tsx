/** Equivalent terminal commands for Linux (bash), Windows Command Prompt and PowerShell. */
import { useMemo, useState } from 'preact/hooks';
import { copyText } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

export interface CommandRow {
  readonly task: string;
  readonly linux: string;
  /** Empty when Command Prompt has no built-in equivalent. */
  readonly cmd: string;
  readonly ps: string;
  readonly note?: string;
}

export const COMMANDS: Record<string, readonly CommandRow[]> = {
  'Files and folders': [
    { task: 'Show the current folder', linux: 'pwd', cmd: 'cd', ps: 'Get-Location' },
    { task: 'List files, including hidden ones', linux: 'ls -la', cmd: 'dir /a', ps: 'Get-ChildItem -Force' },
    { task: 'Change folder', linux: 'cd path/to/folder', cmd: 'cd /d D:\\path\\to\\folder', ps: 'Set-Location path\\to\\folder', note: 'In cmd, /d also switches drive.' },
    { task: 'Go to your home folder', linux: 'cd ~', cmd: 'cd /d %USERPROFILE%', ps: 'Set-Location ~' },
    { task: 'Create a folder (with parents)', linux: 'mkdir -p a/b/c', cmd: 'mkdir a\\b\\c', ps: 'New-Item -ItemType Directory -Force a\\b\\c' },
    { task: 'Create an empty file', linux: 'touch notes.txt', cmd: 'type nul > notes.txt', ps: 'New-Item -ItemType File notes.txt' },
    { task: 'Copy a file', linux: 'cp source.txt target.txt', cmd: 'copy source.txt target.txt', ps: 'Copy-Item source.txt target.txt' },
    { task: 'Copy a folder', linux: 'cp -r source target', cmd: 'robocopy source target /E', ps: 'Copy-Item source target -Recurse' },
    { task: 'Move or rename', linux: 'mv old.txt new.txt', cmd: 'move old.txt new.txt', ps: 'Move-Item old.txt new.txt' },
    { task: 'Delete a file', linux: 'rm file.txt', cmd: 'del file.txt', ps: 'Remove-Item file.txt' },
    {
      task: 'Delete a folder and its contents',
      linux: 'rm -r folder',
      cmd: 'rmdir /s /q folder',
      ps: 'Remove-Item folder -Recurse -Force',
      note: 'There is no recycle bin here: deleted files are gone.',
    },
    {
      task: 'Create a symbolic link',
      linux: 'ln -s target link',
      cmd: 'mklink link target',
      ps: 'New-Item -ItemType SymbolicLink -Path link -Target target',
      note: 'On Windows this needs an administrator prompt or Developer Mode; use mklink /d for folders.',
    },
    {
      task: 'Size of a folder',
      linux: 'du -sh folder',
      cmd: 'dir /s folder',
      ps: '(Get-ChildItem folder -Recurse -File | Measure-Object Length -Sum).Sum',
      note: 'dir /s prints the total at the end.',
    },
    { task: 'Free disk space', linux: 'df -h', cmd: 'fsutil volume diskfree C:', ps: 'Get-PSDrive -PSProvider FileSystem' },
  ],
  'Reading and writing text': [
    { task: 'Print a file', linux: 'cat file.txt', cmd: 'type file.txt', ps: 'Get-Content file.txt' },
    { task: 'Page through a file', linux: 'less file.txt', cmd: 'more file.txt', ps: 'Get-Content file.txt | Out-Host -Paging' },
    { task: 'First 20 lines', linux: 'head -n 20 file.txt', cmd: '', ps: 'Get-Content file.txt -TotalCount 20' },
    { task: 'Last 20 lines', linux: 'tail -n 20 file.txt', cmd: '', ps: 'Get-Content file.txt -Tail 20' },
    { task: 'Follow a growing log', linux: 'tail -f app.log', cmd: '', ps: 'Get-Content app.log -Wait -Tail 10' },
    { task: 'Count lines', linux: 'wc -l file.txt', cmd: 'find /c /v "" file.txt', ps: '(Get-Content file.txt | Measure-Object -Line).Lines' },
    { task: 'Compare two files', linux: 'diff a.txt b.txt', cmd: 'fc a.txt b.txt', ps: 'Compare-Object (Get-Content a.txt) (Get-Content b.txt)' },
    { task: 'Sort lines', linux: 'sort file.txt', cmd: 'sort file.txt', ps: 'Get-Content file.txt | Sort-Object' },
    { task: 'Sort and remove duplicates', linux: 'sort -u file.txt', cmd: '', ps: 'Get-Content file.txt | Sort-Object -Unique' },
    { task: 'Write text to a file', linux: 'echo "hello" > file.txt', cmd: 'echo hello> file.txt', ps: 'Set-Content file.txt "hello"' },
    { task: 'Append text to a file', linux: 'echo "more" >> file.txt', cmd: 'echo more>> file.txt', ps: 'Add-Content file.txt "more"' },
  ],
  Searching: [
    { task: 'Find text in a file', linux: 'grep -n "error" app.log', cmd: 'findstr /n "error" app.log', ps: 'Select-String -Pattern "error" -Path app.log' },
    { task: 'Find text in all files below here', linux: 'grep -rn "error" .', cmd: 'findstr /s /n "error" *', ps: 'Get-ChildItem -Recurse -File | Select-String "error"' },
    {
      task: 'Case-insensitive search',
      linux: 'grep -in "error" app.log',
      cmd: 'findstr /i /n "error" app.log',
      ps: 'Select-String "error" app.log',
      note: 'Select-String ignores case unless you add -CaseSensitive.',
    },
    { task: 'Find files by name', linux: 'find . -name "*.log"', cmd: 'dir /s /b *.log', ps: 'Get-ChildItem -Recurse -Filter *.log' },
    { task: 'Find where a program is', linux: 'command -v python3', cmd: 'where python', ps: 'Get-Command python' },
  ],
  Processes: [
    { task: 'List running processes', linux: 'ps aux', cmd: 'tasklist', ps: 'Get-Process' },
    { task: 'Busiest processes', linux: 'top', cmd: 'taskmgr', ps: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10', note: 'taskmgr opens Task Manager.' },
    { task: 'Stop a process by ID', linux: 'kill 1234', cmd: 'taskkill /PID 1234', ps: 'Stop-Process -Id 1234' },
    { task: 'Stop a process by name', linux: 'pkill firefox', cmd: 'taskkill /IM firefox.exe', ps: 'Stop-Process -Name firefox' },
    { task: 'Force a process to stop', linux: 'kill -9 1234', cmd: 'taskkill /F /PID 1234', ps: 'Stop-Process -Id 1234 -Force' },
    { task: 'Run something in the background', linux: 'long-task &', cmd: 'start /b long-task', ps: 'Start-Job { long-task }' },
  ],
  Network: [
    { task: 'Show IP addresses', linux: 'ip -brief address', cmd: 'ipconfig', ps: 'Get-NetIPAddress' },
    { task: 'Check that a host responds', linux: 'ping -c 4 example.org', cmd: 'ping example.org', ps: 'Test-Connection example.org -Count 4' },
    { task: 'Look up a domain name', linux: 'nslookup example.org', cmd: 'nslookup example.org', ps: 'Resolve-DnsName example.org' },
    { task: 'Trace the route to a host', linux: 'tracepath example.org', cmd: 'tracert example.org', ps: 'Test-NetConnection example.org -TraceRoute' },
    { task: 'List listening ports', linux: 'ss -tulpn', cmd: 'netstat -ano', ps: 'Get-NetTCPConnection -State Listen' },
    { task: 'Test a TCP port', linux: 'nc -zv example.org 443', cmd: '', ps: 'Test-NetConnection example.org -Port 443' },
    {
      task: 'Download a file',
      linux: 'curl -LO https://example.org/file.zip',
      cmd: 'curl -LO https://example.org/file.zip',
      ps: 'Invoke-WebRequest https://example.org/file.zip -OutFile file.zip',
      note: 'curl is included with Windows 10 (1803) and later.',
    },
    { task: 'Clear the DNS cache', linux: 'resolvectl flush-caches', cmd: 'ipconfig /flushdns', ps: 'Clear-DnsClientCache' },
  ],
  System: [
    { task: 'Operating system version', linux: 'cat /etc/os-release', cmd: 'ver', ps: '[System.Environment]::OSVersion' },
    { task: 'Detailed system information', linux: 'uname -a', cmd: 'systeminfo', ps: 'Get-ComputerInfo' },
    { task: 'Computer name', linux: 'hostname', cmd: 'hostname', ps: '$env:COMPUTERNAME' },
    { task: 'Current user', linux: 'whoami', cmd: 'whoami', ps: 'whoami' },
    { task: 'Time since start-up', linux: 'uptime', cmd: 'systeminfo | find "Boot Time"', ps: '(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime' },
    { task: 'Memory use', linux: 'free -h', cmd: 'systeminfo | find "Memory"', ps: 'Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory, TotalVisibleMemorySize' },
    { task: 'Processor', linux: 'lscpu', cmd: 'echo %PROCESSOR_IDENTIFIER%', ps: 'Get-CimInstance Win32_Processor' },
    { task: 'Clear the screen', linux: 'clear', cmd: 'cls', ps: 'Clear-Host' },
    { task: 'Command history', linux: 'history', cmd: 'doskey /history', ps: 'Get-History' },
    { task: 'Shut down now', linux: 'systemctl poweroff', cmd: 'shutdown /s /t 0', ps: 'Stop-Computer' },
    { task: 'Restart now', linux: 'systemctl reboot', cmd: 'shutdown /r /t 0', ps: 'Restart-Computer' },
  ],
  'Software packages': [
    { task: 'Refresh the package list', linux: 'sudo apt update', cmd: 'winget source update', ps: 'winget source update', note: 'apt on Ubuntu and Debian; winget on Windows 10 and 11.' },
    { task: 'Upgrade everything', linux: 'sudo apt upgrade', cmd: 'winget upgrade --all', ps: 'winget upgrade --all' },
    { task: 'Search for a package', linux: 'apt search inkscape', cmd: 'winget search inkscape', ps: 'winget search inkscape' },
    { task: 'Install a package', linux: 'sudo apt install inkscape', cmd: 'winget install Inkscape.Inkscape', ps: 'winget install Inkscape.Inkscape' },
    { task: 'Remove a package', linux: 'sudo apt remove inkscape', cmd: 'winget uninstall Inkscape.Inkscape', ps: 'winget uninstall Inkscape.Inkscape' },
    { task: 'List installed packages', linux: 'apt list --installed', cmd: 'winget list', ps: 'winget list' },
  ],
  'Permissions and services': [
    { task: 'Run as administrator', linux: 'sudo command', cmd: 'runas /user:Administrator cmd', ps: 'Start-Process powershell -Verb RunAs' },
    { task: 'Show permissions', linux: 'ls -l file.txt', cmd: 'icacls file.txt', ps: 'Get-Acl file.txt | Format-List' },
    { task: 'Make a script executable', linux: 'chmod +x script.sh', cmd: '', ps: '', note: 'Windows decides by file extension instead.' },
    { task: 'Give a user read access', linux: 'chmod o+r file.txt', cmd: 'icacls file.txt /grant Alex:R', ps: 'icacls file.txt /grant Alex:R' },
    { task: 'Take ownership', linux: 'sudo chown alex:alex file.txt', cmd: 'takeown /f file.txt', ps: 'takeown /f file.txt' },
    { task: 'Service status', linux: 'systemctl status nginx', cmd: 'sc query nginx', ps: 'Get-Service nginx' },
    { task: 'Start a service', linux: 'sudo systemctl start nginx', cmd: 'net start nginx', ps: 'Start-Service nginx' },
    { task: 'Stop a service', linux: 'sudo systemctl stop nginx', cmd: 'net stop nginx', ps: 'Stop-Service nginx' },
    {
      task: 'Start a service at boot',
      linux: 'sudo systemctl enable nginx',
      cmd: 'sc config nginx start= auto',
      ps: 'Set-Service nginx -StartupType Automatic',
      note: 'sc needs the space after "start=".',
    },
  ],
  'Archives and checksums': [
    {
      task: 'Create a zip file',
      linux: 'zip -r archive.zip folder',
      cmd: 'tar -a -c -f archive.zip folder',
      ps: 'Compress-Archive folder archive.zip',
      note: 'tar is included with Windows 10 (1803) and later.',
    },
    { task: 'Extract a zip file', linux: 'unzip archive.zip', cmd: 'tar -xf archive.zip', ps: 'Expand-Archive archive.zip -DestinationPath archive' },
    { task: 'Create a .tar.gz', linux: 'tar -czf archive.tar.gz folder', cmd: 'tar -czf archive.tar.gz folder', ps: 'tar -czf archive.tar.gz folder' },
    { task: 'Extract a .tar.gz', linux: 'tar -xzf archive.tar.gz', cmd: 'tar -xzf archive.tar.gz', ps: 'tar -xzf archive.tar.gz' },
    { task: 'SHA-256 checksum', linux: 'sha256sum file.iso', cmd: 'certutil -hashfile file.iso SHA256', ps: 'Get-FileHash file.iso -Algorithm SHA256' },
  ],
  'Environment variables': [
    { task: 'List all variables', linux: 'printenv', cmd: 'set', ps: 'Get-ChildItem Env:' },
    { task: 'Show one variable', linux: 'echo "$HOME"', cmd: 'echo %USERPROFILE%', ps: '$env:USERPROFILE' },
    { task: 'Set for this session', linux: 'export NAME=value', cmd: 'set NAME=value', ps: '$env:NAME = "value"' },
    {
      task: 'Set permanently for your user',
      linux: "echo 'export NAME=value' >> ~/.bashrc",
      cmd: 'setx NAME value',
      ps: '[Environment]::SetEnvironmentVariable("NAME", "value", "User")',
      note: 'Opens in new terminals, not the current one.',
    },
    { task: 'Add a folder to PATH for this session', linux: 'export PATH="$PATH:/opt/tool/bin"', cmd: 'set PATH=%PATH%;C:\\tool\\bin', ps: '$env:Path += ";C:\\tool\\bin"' },
  ],
};

const SHELLS = [
  { key: 'linux', label: 'Linux (bash)' },
  { key: 'cmd', label: 'Windows cmd' },
  { key: 'ps', label: 'PowerShell' },
] as const;

type ShellKey = (typeof SHELLS)[number]['key'];

function Commands({ toolId }: { toolId: string }) {
  const [shown, setShown] = usePersistentState<readonly ShellKey[]>(
    toolId,
    (stored: Values | undefined) => {
      const list = Array.isArray(stored?.shells) ? (stored.shells as unknown[]).filter((key): key is ShellKey => key === 'linux' || key === 'cmd' || key === 'ps') : [];
      return list.length > 0 ? list : ['linux', 'cmd', 'ps'];
    },
    (shells) => ({ shells: [...shells] }),
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return Object.entries(COMMANDS)
      .filter(([name]) => category === 'all' || name === category)
      .map(([name, rows]) => [name, rows.filter((row) => needle === '' || [row.task, row.linux, row.cmd, row.ps, row.note ?? ''].some((text) => text.toLowerCase().includes(needle)))] as const)
      .filter(([, rows]) => rows.length > 0);
  }, [query, category]);

  const toggle = (key: ShellKey) =>
    setShown((previous) =>
      previous.includes(key) ? (previous.length > 1 ? previous.filter((item) => item !== key) : previous) : SHELLS.map((shell) => shell.key).filter((item) => item === key || previous.includes(item)),
    );

  const copy = (text: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${text}`);
    });

  const columns = SHELLS.filter((shell) => shown.includes(shell.key));

  return (
    <section class="tool tool-commands" data-testid="tool" data-state="done">
      <div class="tool-options commands-toolbar">
        <label class="control commands-search">
          <span class="control-label">Search</span>
          <input class="input" type="search" placeholder="copy, port, zip, service…" value={query} onInput={(event) => setQuery(event.currentTarget.value)} data-testid="commands-search" />
        </label>
        <label class="control">
          <span class="control-label">Topic</span>
          <select class="input" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
            <option value="all">All topics</option>
            {Object.keys(COMMANDS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div class="control">
          <span class="control-label">Shells</span>
          <div class="button-row">
            {SHELLS.map((shell) => (
              <label key={shell.key} class="toggle" for={`shell-${shell.key}`}>
                <input id={`shell-${shell.key}`} type="checkbox" checked={shown.includes(shell.key)} onChange={() => toggle(shell.key)} />
                <span class="toggle-track" aria-hidden="true" />
                <span>{shell.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div class="commands-table-wrap">
        <table class="commands-table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              {columns.map((shell) => (
                <th key={shell.key} scope="col">
                  {shell.label}
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(([name, rows]) => (
            <tbody key={name}>
              <tr class="commands-group">
                <th colSpan={columns.length + 1} scope="colgroup">
                  {name}
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row.task}>
                  <th scope="row">
                    {row.task}
                    {row.note && <small>{row.note}</small>}
                  </th>
                  {columns.map((shell) => {
                    const command = row[shell.key];
                    return (
                      <td key={shell.key}>
                        {command ? (
                          <button type="button" class="command" onClick={() => copy(command)} title="Copy">
                            <code>{command}</code>
                            <Icon name="copy" size={12} />
                          </button>
                        ) : (
                          <span class="command-none">No built-in command</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {groups.length === 0 && <p class="control-help">Nothing matches “{query}”.</p>}
      </div>
    </section>
  );
}

export default defineCustomTool(Commands);
