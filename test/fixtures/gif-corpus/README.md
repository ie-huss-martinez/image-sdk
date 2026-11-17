# GIF corpus

GIF files from other decoders' test suites: real files, and the malformed ones their bug reports came with. `src/adapters/gif-open.browser.test.ts` opens every one through the SDK's own decoder in Chromium, Firefox and WebKit ([ADR 0011](../../../docs/adr/0011-gif-and-animation.md)): a file either opens as the first frame the browser's decoder draws, or is refused for a reason the test names.

They're test fixtures only. Nothing here is part of the published package, and no test fetches anything from the network.

## Where the files come from

Each folder holds files copied unchanged from one project, at the commit given, with that project's licence beside them. File names are the originals.

| Folder | Project | Commit | Copied from | Licence |
| --- | --- | --- | --- | --- |
| `giflib` | [GIFLIB](https://sourceforge.net/projects/giflib/), from the mirror at `github.com/mirrorer/giflib` | `fa37672085ce4b3d62c51627ab3c8cf2dda8009a` | `pic/`, `tests/` | MIT (`COPYING`) |
| `go` | [Go](https://github.com/golang/go) | `5552f60b11ddb83eee7a01893ffc8bfb76a7115d` | `src/image/testdata/` | BSD-3-Clause (`LICENSE`) |
| `image` | [image-rs/image](https://github.com/image-rs/image) | `e70e9fe5073f4b298a33b72993847241a8eaaca6` | `tests/images/gif/`, `tests/regression/gif/` | MIT or Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`) |
| `image-gif` | [image-rs/image-gif](https://github.com/image-rs/image-gif) | `a5f89ddc2b29424334244c97456b4a26e208aa7d` | `tests/samples/`, `tests/crashtest/`, `tests/regression/`, `tests/stall/` | MIT or Apache-2.0 (`LICENSE-MIT`, `LICENSE-APACHE`) |
| `pillow` | [Pillow](https://github.com/python-pillow/Pillow) | `b0ab40eae3497a430b9a3763b413ee45ecca07ca` | `Tests/images/` | MIT-CMU (`LICENSE`) |

## What was left out

- Files over 40 kB, to keep the repository small.
- GIFLIB's `doc/whatsinagif` images, which illustrate a tutorial and aren't test files.
- `bufo-thinks-about-fishsticks.gif` from image-gif, whose own origin isn't clear from that repository.

The files are used as each project distributes them, under its licence. If one turns out not to be that project's to license, remove it and its line in the test.
