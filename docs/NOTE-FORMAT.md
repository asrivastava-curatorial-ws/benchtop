# The .bnote format (Benchtop notes)

A `.bnote` file holds one note and a copy of every file in it, so the note
stays complete when the original pictures, videos or documents are moved or
deleted. It is an ordinary ZIP archive, readable with any unzip tool, in the
same spirit as EPUB and OpenDocument files.

## Layout

| Entry                         | Content                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mimetype`                    | The text `application/vnd.benchtop.note+zip`. First entry, stored without compression, so the type can be recognised from the first bytes of the file. |
| `note.json`                   | `{"format": "benchtop-note", "version": 1, "note": { … }}` (below).                                                                                    |
| `files/<sha-256>/<file name>` | Each attached file, once, in a folder named by the SHA-256 of its bytes (64 lower-case hex digits).                                                    |
| `index.html`                  | A readable copy of the note that opens in any web browser and links to the files above. Benchtop ignores it when reading.                              |

Readers must ignore entries they do not know. Writers should store files that
are already compressed (JPEG, PNG, video, audio) without compressing them again.

## note.json

```json
{
  "format": "benchtop-note",
  "version": 1,
  "note": {
    "id": "6f1c…",
    "title": "Engine Hall survey",
    "created": "2026-11-22T10:15:00.000Z",
    "modified": "2026-11-22T11:02:41.000Z",
    "pinned": false,
    "tags": [],
    "blocks": [ … ],
    "attachments": [
      { "id": "<sha-256>", "name": "label.png", "type": "image/png", "size": 48213 }
    ]
  }
}
```

`attachments` lists every file the blocks refer to. Each entry's `id` is the
SHA-256 of the file and names its folder under `files/`.

## Blocks

Blocks are drawn in order. Every block has an `id` (any string) and a `type`.

| type        | Fields                                          | Meaning                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`      | `html`                                          | Rich text. Only `p br div b strong i em u s strike del code pre a ul ol li h1 h2 h3 blockquote sub sup mark table thead tbody tr th td hr` are kept, links (`href`) only to `http:`, `https:` and `mailto:` addresses. |
| `markdown`  | `source`                                        | CommonMark with GitHub tables and task lists; `$…$` and `$$…$$` are LaTeX maths.                                                                                                                                       |
| `code`      | `source`, `language`                            | Source code; `language` is a hint such as `python` or `text`.                                                                                                                                                          |
| `checklist` | `items: [{text, done}]`                         | A to-do list.                                                                                                                                                                                                          |
| `divider`   | —                                               | A horizontal line.                                                                                                                                                                                                     |
| `link`      | `url`, `title`, `note`, `snapshot?`, `savedAt?` | A web address. `snapshot` is the id of an attached PDF copy of the page, saved at `savedAt` (ISO 8601).                                                                                                                |
| `file`      | `file`, `caption`, `width?`                     | An attached file, shown according to its type (picture, video, audio, PDF, 3D model, text or a plain file). `width` (percent) applies to pictures.                                                                     |

Unknown block types should be skipped, not treated as errors, so newer notes
still open in older readers as far as possible. A reader that meets a
`version` greater than it knows should refuse the file and say why.

## Version history

- **1** (Benchtop 4.0): first version.
