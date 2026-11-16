import { ToolError } from '../../lib/errors';
import { esc, heading, html, report, table } from '../../lib/net/report';
import { defineTextTool } from '../types';

const SHEET: [string, [string, string][]][] = [
  [
    'Characters',
    [
      ['.', 'Any character except a new line'],
      ['\\d  \\D', 'Digit / not a digit'],
      ['\\w  \\W', 'Word character [A-Za-z0-9_] / not one'],
      ['\\s  \\S', 'Whitespace / not whitespace'],
      ['[abc]', 'Any of a, b or c'],
      ['[^abc]', 'Anything except a, b or c'],
      ['[a-z]', 'A character in the range'],
      ['\\p{L}', 'Any letter in any script (needs the u flag)'],
      ['\\t \\n \\r', 'Tab, new line, carriage return'],
      ['\\u00e9  \\x41', 'Character by code'],
    ],
  ],
  [
    'Anchors',
    [
      ['^  $', 'Start / end of the text (of each line with m)'],
      ['\\b  \\B', 'Word boundary / not a boundary'],
      ['(?=x)  (?!x)', 'Followed by x / not followed by x'],
      ['(?<=x)  (?<!x)', 'Preceded by x / not preceded by x'],
    ],
  ],
  [
    'Repeats',
    [
      ['a*  a+  a?', 'Zero or more / one or more / optional'],
      ['a{3}  a{2,}  a{2,5}', 'Exactly 3 / 2 or more / 2 to 5'],
      ['a*?  a+?', 'As few as possible (lazy)'],
    ],
  ],
  [
    'Groups',
    [
      ['(abc)', 'Capture group, used as $1 or \\1'],
      ['(?<name>abc)', 'Named group, used as $<name>'],
      ['(?:abc)', 'Group without capturing'],
      ['a|b', 'a or b'],
      ['\\1  \\k<name>', 'Repeat what a group matched'],
    ],
  ],
  [
    'Flags',
    [
      ['g', 'Find every match'],
      ['i', 'Ignore case'],
      ['m', '^ and $ match at line breaks'],
      ['s', '. also matches new lines'],
      ['u', 'Unicode: \\p{…} and full code points'],
      ['y', 'Sticky: match only at lastIndex'],
    ],
  ],
  [
    'Common patterns',
    [
      ['^[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+$', 'Email address (practical, not RFC-complete)'],
      ['^https?:\\/\\/[^\\s/$.?#].[^\\s]*$', 'Web address'],
      ['^\\d{6}$', 'Indian PIN code'],
      ['^[6-9]\\d{9}$', 'Indian mobile number (10 digits)'],
      ['^[A-Z]{5}\\d{4}[A-Z]$', 'PAN format'],
      ['^\\d{2}[A-Z]{5}\\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$', 'GSTIN format'],
      ['^#?([0-9a-f]{3}){1,2}$', 'Hex colour (with the i flag)'],
      ['^\\d{4}-\\d{2}-\\d{2}$', 'ISO date'],
      ['^(25[0-5]|2[0-4]\\d|1?\\d?\\d)(\\.(25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}$', 'IPv4 address'],
    ],
  ],
];

function code(language: string, pattern: string, flags: string): string {
  const js = `/${pattern.replace(/\//g, '\\/')}/${flags}`;
  const escaped = (quote: string) => pattern.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`);
  const inline = (map: Record<string, string>) =>
    [...flags]
      .map((flag) => map[flag])
      .filter(Boolean)
      .join('');
  switch (language) {
    case 'javascript':
      return `const pattern = ${js};\nconst matches = [...text.matchAll(${flags.includes('g') ? 'pattern' : `new RegExp(pattern.source, pattern.flags + 'g')`})];\nfor (const match of matches) console.log(match.index, match[0]);`;
    case 'python':
      return `import re\n\npattern = re.compile(r"${pattern.replace(/"/g, '\\"')}"${flags.replace(/[gyu]/g, '') ? `, ${[...flags.replace(/[gyu]/g, '')].map((flag) => ({ i: 're.IGNORECASE', m: 're.MULTILINE', s: 're.DOTALL' })[flag]).join(' | ')}` : ''})\nfor match in pattern.finditer(text):\n    print(match.start(), match.group(0))`;
    case 'go':
      return `import "regexp"\n\nre := regexp.MustCompile(\`${inline({ i: 'i', m: 'm', s: 's' }) ? `(?${inline({ i: 'i', m: 'm', s: 's' })})` : ''}${pattern}\`)\nfor _, m := range re.FindAllStringIndex(text, -1) {\n\tfmt.Println(m[0], text[m[0]:m[1]])\n}`;
    case 'java':
      return `import java.util.regex.*;\n\nPattern pattern = Pattern.compile("${escaped('"')}"${flags.replace(/[gyu]/g, '') ? `, ${[...flags.replace(/[gyu]/g, '')].map((flag) => ({ i: 'Pattern.CASE_INSENSITIVE', m: 'Pattern.MULTILINE', s: 'Pattern.DOTALL' })[flag]).join(' | ')}` : ''});\nMatcher matcher = pattern.matcher(text);\nwhile (matcher.find()) System.out.println(matcher.start() + " " + matcher.group());`;
    case 'csharp':
      return `using System.Text.RegularExpressions;\n\nvar regex = new Regex(@"${pattern.replace(/"/g, '""')}"${flags.replace(/[gyu]/g, '') ? `, ${[...flags.replace(/[gyu]/g, '')].map((flag) => ({ i: 'RegexOptions.IgnoreCase', m: 'RegexOptions.Multiline', s: 'RegexOptions.Singleline' })[flag]).join(' | ')}` : ''});\nforeach (Match match in regex.Matches(text)) Console.WriteLine($"{match.Index} {match.Value}");`;
    case 'php':
      return `preg_match_all('/${pattern.replace(/\//g, '\\/').replace(/'/g, "\\'")}/${inline({ i: 'i', m: 'm', s: 's', u: 'u' })}', $text, $matches, PREG_OFFSET_CAPTURE);\nforeach ($matches[0] as [$value, $offset]) echo "$offset $value\\n";`;
    case 'rust':
      return `use regex::Regex;\n\nlet re = Regex::new(r"${inline({ i: 'i', m: 'm', s: 's' }) ? `(?${inline({ i: 'i', m: 'm', s: 's' })})` : ''}${pattern.replace(/"/g, '\\"')}").unwrap();\nfor m in re.find_iter(text) {\n    println!("{} {}", m.start(), m.as_str());\n}`;
    default:
      return `grep -${flags.includes('i') ? 'i' : ''}P '${pattern.replace(/'/g, `'\\''`)}' file.txt`;
  }
}

export default defineTextTool({
  input: false,
  output: { label: 'Code' },
  options: [
    { key: 'pattern', label: 'Pattern', type: 'text', default: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})', mono: true, wide: true },
    { key: 'flags', label: 'Flags', type: 'text', default: 'g', mono: true },
    {
      key: 'language',
      label: 'Language',
      type: 'select',
      choices: [
        { value: 'javascript', label: 'JavaScript' },
        { value: 'python', label: 'Python' },
        { value: 'go', label: 'Go' },
        { value: 'java', label: 'Java' },
        { value: 'csharp', label: 'C#' },
        { value: 'php', label: 'PHP' },
        { value: 'rust', label: 'Rust' },
        { value: 'grep', label: 'grep' },
      ],
      default: 'javascript',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const flags = [...new Set(o.flags.replace(/[^gimsuy]/g, ''))].join('');
    try {
      new RegExp(o.pattern, flags.replace('g', ''));
    } catch (error) {
      throw new ToolError(`The pattern is not valid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const sheet = SHEET.map(
      ([title, rows]) =>
        heading(title) +
        table(
          ['Syntax', 'Meaning'],
          rows.map(([syntax, meaning]) => [html(`<code>${esc(syntax)}</code>`), meaning]),
        ),
    ).join('');
    return { output: code(o.language, o.pattern, flags), language: o.language === 'javascript' ? 'javascript' : 'text', preview: { kind: 'html', html: report(sheet) } };
  },
});
