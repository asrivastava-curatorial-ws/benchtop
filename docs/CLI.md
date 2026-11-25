# Command line

The desktop app doubles as a command-line program. `benchtop <command> …` runs the converters, the AI jobs, model downloads, the online checks and file hashing from a terminal or a script, without opening a window. `benchtop` on its own (or with a file) opens the app.

`benchtop --help` prints the same summary as this page.

## Where the program is

| System  | Command                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------- |
| Linux   | `benchtop`: the `.deb` and `.rpm` packages install `/usr/bin/benchtop`; an AppImage runs directly        |
| Windows | `benchtop.exe` in the folder the installer used (Start menu → right-click Benchtop → Open file location) |
| macOS   | the program inside the app bundle, `/Applications/Benchtop.app/Contents/MacOS/`                          |

On Windows the app is a windowed program, so in Command Prompt run it as `benchtop … | more` to make the prompt wait for its output. PowerShell waits by itself.

## Opening the app

```sh
benchtop                                  # open the app
benchtop open json-formatter              # open it on one tool (the id in the address, #/tool/<id>)
benchtop open '#/tool/calc-finance?calc=loan-emi&s=…'   # a link copied from a calculator's Link button
benchtop version                          # print the version
benchtop version --check                  # ask GitHub whether a newer release exists
```

## Files

```sh
benchtop convert --list                                   # every recipe and its settings
benchtop convert media-convert talk.mov -s to=mp4         # one job per file
benchtop convert video-compress *.mp4 -s crf=28 height=720 -o small/
benchtop convert video-trim clip.mp4 -s start=0:10 end=0:42
benchtop convert document report.docx -s to=pdf           # LibreOffice
benchtop convert document scan.pdf -s to=docx             # PDF to Word, also with LibreOffice
benchtop convert postscript figure.eps -s to=pdf          # Ghostscript
benchtop convert xps invoice.oxps                         # XPS to PDF with MuPDF
benchtop convert archive photos.rar -s to=zip             # bsdtar
benchtop convert pdf-protect contract.pdf -s password=… -o locked.pdf
benchtop programs                                         # which converter programs are installed
benchtop hash *.iso                                       # SHA-256; add --sha512 for SHA-512
```

Converters run the programs installed on the computer (FFmpeg, LibreOffice, Pandoc, ImageMagick, Inkscape, Calibre, qpdf, Ghostscript, MuPDF, bsdtar) with argument lists built from fixed recipes; no shell is involved. Recipes that join files (`video-merge`, `audio-merge`, the subtitle and watermark recipes) take all the files as one job.

## AI (runs on this computer)

Models are downloaded once and checked against fixed SHA-256 fingerprints, exactly as in Settings → AI models.

```sh
benchtop models                           # list models, sizes and what is installed
benchtop models get runtime isnet-general # download the engine and a model
benchtop models get whisper-small silero-vad   # a multilingual speech model and the pause detector
benchtop remove-bg photo.jpg              # background removal (--model, --mask, --crop)
benchtop upscale scan.png --scale 4       # Real-ESRGAN
benchtop blur-faces team.jpg --pixelate   # or --fill for solid boxes
benchtop transcribe lecture.mp4 --language hi --format srt
benchtop transcribe interview.wav --language auto --translate --format txt
```

Transcription understands 99 languages, including Hindi, Bengali, Marathi, Tamil, Telugu, Kannada, Malayalam, Gujarati, Punjabi and Urdu; every language except English needs a multilingual model (`whisper-base`, `whisper-small` or `whisper-turbo`). `--cpu` keeps a job on the processor even when a GPU runtime (CUDA on Linux, DirectML on Windows) is installed.

## Online checks

```sh
benchtop dns example.org MX --server 1.1.1.1
benchtop dns example.org --server https://dns.google/dns-query --dnssec
benchtop tls example.org:443
benchtop http https://example.org --method HEAD
benchtop whois example.org
benchtop ports example.org 22 80 443
```

They make the same requests as the tools in Online checks, only to the hosts you name. The answers are JSON (WHOIS prints the registry text).

## Common options

| Option                       | Meaning                                                                 |
| ---------------------------- | ----------------------------------------------------------------------- |
| `-o`, `--out <file\|folder>` | Where results go. Default: beside the input. `-` prints text to stdout. |
| `-s key=value`               | A converter setting; repeat for more.                                   |
| `--cpu`                      | Run AI models on the processor.                                         |
| `-q`, `--quiet`              | No progress output.                                                     |

Results are printed as paths (for files) or JSON (for checks), so they can be piped to other programs. The exit code is 0 on success and 1 on any error, with the reason on stderr.
