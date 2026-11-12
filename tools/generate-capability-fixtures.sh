#!/usr/bin/env bash
# Generates the encoded images the capability matrix decodes, into
# e2e/fixtures/, with real encoders in a pinned Debian image. They're solid
# colours made here, never photos (CONTRIBUTING.md). The files that need
# assembling, such as JPEGs with secondary images and the GIF whose frame
# overflows its screen, are built from these by e2e/fixtures.ts at test time.
#
# The committed files are the source of truth: regenerating them gives
# equivalent images, not necessarily identical bytes.
set -euo pipefail
cd "$(dirname "$0")/.."
image="debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2"
mkdir -p e2e/fixtures
docker run --rm \
  --volume "$PWD/e2e/fixtures:/out" \
  "$image" \
  bash -euo pipefail -c '
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -qq --no-install-recommends \
      imagemagick=8:7.1.1.43+dfsg1-1+deb13u14 \
      libjpeg-turbo-progs=1:2.1.5-4 \
      webp=1.5.0-0.1 \
      libavif-bin=1.2.1-1.2 \
      libheif-examples=1.23.6-2~deb13u1 \
      libheif-plugin-x265=1.23.6-2~deb13u1 \
      libheif-plugin-aomenc=1.23.6-2~deb13u1 >/dev/null
    cd /tmp
    # The primary image is red, and every secondary image blue and larger, so
    # a test can tell which one a browser decoded.
    magick -size 48x32 xc:"#ff0000" -strip primary.ppm
    magick -size 96x64 xc:"#0000ff" -strip secondary.ppm
    magick -size 96x64 xc:"#ff0000" -strip large.ppm
    magick primary.ppm -strip -define png:exclude-chunks=date,time primary.png
    magick large.ppm -strip -define png:exclude-chunks=date,time large.png

    cp primary.png /out/primary.png
    cjpeg -quality 92 -baseline primary.ppm > /out/primary.jpg
    cjpeg -quality 92 -baseline secondary.ppm > /out/secondary.jpg
    cwebp -quiet -q 90 primary.png -o /out/primary-lossy.webp
    cwebp -quiet -lossless primary.png -o /out/primary-lossless.webp
    magick primary.ppm -strip /out/primary.gif
    magick large.ppm -strip /out/large.gif
    magick primary.ppm -strip BMP3:/out/primary.bmp
    avifenc --speed 8 -q 92 primary.png /out/primary.avif >/dev/null
    heif-enc --quality 90 primary.png -o /out/primary.heic >/dev/null
    # A 96 × 64 primary with a 48 × 32 thumbnail: the sizes tell them apart.
    heif-enc --quality 90 --thumb 48 large.png -o /out/thumbnail.heic >/dev/null
    heif-enc --avif --quality 90 --thumb 48 large.png -o /out/thumbnail.avif >/dev/null
    chown -R '"$(id -u):$(id -g)"' /out
  '
ls -l e2e/fixtures
