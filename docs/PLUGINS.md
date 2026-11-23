# Plugins

A plugin is one JavaScript file that adds a text tool to Benchtop. Add it in **Reference and extras → Plugins** (write it under Code, or choose **Add from file…**). Once added, it can also be a step in the **File Pipeline**.

```js
benchtop.register({
  name: 'Accession numbers',
  description: 'Pad accession numbers such as VITM/2024/7 to VITM/2024/0007 and sort them.',
  options: [
    { key: 'digits', label: 'Digits', type: 'number', default: 4, min: 1, max: 8 },
    { key: 'sort', label: 'Sort', type: 'toggle', default: true },
  ],
  sample: 'VITM/2024/12\nVITM/2023/7',
  run(input, options) {
    const lines = input.split('\n').filter(Boolean).map((line) => line.replace(/(\d+)$/, (n) => n.padStart(options.digits, '0')));
    if (options.sort) lines.sort();
    return { output: lines.join('\n'), info: `${lines.length} numbers` };
  },
});
```

`export default { … }` works instead of `benchtop.register({ … })`.

## What a plugin can define

| Field | Meaning |
| --- | --- |
| `name` | Shown in the Plugins list and as a pipeline step. Required. |
| `run(input, options)` | Returns the output text, or `{ output, info, language }`. May be `async`. Required. |
| `description` | One sentence shown above the tool. |
| `sample` | Example input for the Sample button. |
| `language` | Highlighting for the output: `text`, `json`, `javascript`, `typescript`, `jsx`, `html`, `css`, `xml`, `markdown`, `yaml`, `sql`, `cpp` or `python`. |
| `options` | Controls shown above the input; their values arrive in `options`. |

Each option has a `key`, a `label` and a `type`, with a `default`:

- `toggle` (true or false), `number` and `range` (with `min`, `max`, `step`), `text` (with `multiline` and `mono`), `color` (`#rrggbb`)
- `select` and `segmented`, with `choices`: strings, or `{ value, label }` objects
- `heading`, a label that groups the controls after it

## WebAssembly

Put the compiled module in the file as Base64 and instantiate it inside `run` (or once, outside it):

```js
const bytes = Uint8Array.from(atob('AGFzbQEAAAA…'), (c) => c.charCodeAt(0));
const ready = WebAssembly.instantiate(bytes);

benchtop.register({
  name: 'My WebAssembly tool',
  async run(input) {
    const { instance } = await ready;
    return String(instance.exports.answer());
  },
});
```

## The sandbox

Every run starts a fresh worker that holds only the plugin. Before the plugin's code runs, Benchtop removes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `indexedDB`, `caches`, `navigator.storage`, `BroadcastChannel`, `importScripts` and the worker constructors, and the app's content security policy blocks network requests besides. A plugin sees only the text and options it is given, and is stopped after 30 seconds. Plugins are kept in the app's local storage.

The sandbox limits what a plugin can reach, not what it computes from your text: add only plugins you have read or trust.
