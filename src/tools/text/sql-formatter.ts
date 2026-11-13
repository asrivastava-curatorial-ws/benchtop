import { format, type SqlLanguage } from 'sql-formatter';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

const SAMPLE = `select g.name, count(e.id) as exhibits, max(e.updated_at) last_change from galleries g left join exhibits e on e.gallery_id = g.id where g.floor >= 0 and e.status in ('open','maintenance') group by g.name having count(e.id) > 2 order by exhibits desc limit 10;`;

const DIALECTS: { value: SqlLanguage; label: string }[] = [
  { value: 'sql', label: 'Standard SQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'tsql', label: 'SQL Server (T-SQL)' },
  { value: 'plsql', label: 'Oracle PL/SQL' },
  { value: 'bigquery', label: 'BigQuery' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'redshift', label: 'Redshift' },
  { value: 'spark', label: 'Spark SQL' },
  { value: 'duckdb', label: 'DuckDB' },
  { value: 'db2', label: 'Db2' },
  { value: 'trino', label: 'Trino / Presto' },
  { value: 'clickhouse', label: 'ClickHouse' },
];

export default defineTextTool({
  input: { label: 'SQL', sample: SAMPLE, accept: '.sql,.txt' },
  output: { label: 'Formatted SQL' },
  options: [
    { key: 'dialect', label: 'Dialect', type: 'select', choices: DIALECTS, default: 'postgresql' },
    {
      key: 'keywordCase',
      label: 'Keywords',
      type: 'select',
      choices: [
        { value: 'upper', label: 'UPPER' },
        { value: 'lower', label: 'lower' },
        { value: 'preserve', label: 'As written' },
      ],
      default: 'upper',
    },
    {
      key: 'indent',
      label: 'Indent',
      type: 'select',
      choices: [
        { value: '2', label: '2 spaces' },
        { value: '4', label: '4 spaces' },
        { value: 'tab', label: 'Tab' },
      ],
      default: '2',
    },
    {
      key: 'style',
      label: 'Style',
      type: 'select',
      choices: [
        { value: 'standard', label: 'Standard' },
        { value: 'tabularLeft', label: 'Tabular, left' },
        { value: 'tabularRight', label: 'Tabular, right' },
      ],
      default: 'standard',
    },
    { key: 'minify', label: 'Minify', type: 'toggle', default: false },
  ],
  run(input, o) {
    if (o.minify) {
      // Collapse whitespace and drop comments, but never touch strings or quoted names.
      const tokens = (input.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\/|\s+|[^\s'"`-]+|-/g) ?? []).filter((token) => !token.startsWith('--') && !token.startsWith('/*'));
      const tight = /^[(),;=<>+*/]|[(),;=<>+*/]$/;
      let output = '';
      let space = false;
      for (const token of tokens) {
        if (/^\s+$/.test(token)) {
          space = true;
          continue;
        }
        if (space && output !== '' && !tight.test(output.slice(-1)) && !tight.test(token[0] ?? '')) output += ' ';
        output += token;
        space = false;
      }
      return output;
    }
    try {
      return `${format(input, { language: o.dialect as SqlLanguage, keywordCase: o.keywordCase as 'upper' | 'lower' | 'preserve', tabWidth: o.indent === '4' ? 4 : 2, useTabs: o.indent === 'tab', indentStyle: o.style as 'standard' | 'tabularLeft' | 'tabularRight', linesBetweenQueries: 1 })}\n`;
    } catch (error) {
      throw new ToolError((error as Error).message.split('\n')[0] ?? 'This SQL could not be parsed.');
    }
  },
});
