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
    # A quarter turn anticlockwise in irot: upright, it is 32 x 48.
    avifenc --speed 8 -q 92 --irot 1 primary.png /out/rotated.avif >/dev/null
    # Four coloured quadrants, so the pixels show how a decode was oriented:
    # red, green, blue and yellow, from the top left, reading across.
    magick -size 48x32 xc:black \
      -fill "#ff0000" -draw "rectangle 0,0 23,15" -fill "#00ff00" -draw "rectangle 24,0 47,15" \
      -fill "#0000ff" -draw "rectangle 0,16 23,31" -fill "#ffff00" -draw "rectangle 24,16 47,31" \
      -strip quadrants.ppm
    magick quadrants.ppm -strip -define png:exclude-chunks=date,time quadrants.png
    cp quadrants.png /out/quadrants.png
    cjpeg -quality 95 -sample 1x1 -baseline quadrants.ppm > /out/quadrants.jpg
    cwebp -quiet -lossless quadrants.png -o /out/quadrants.webp
    avifenc --speed 8 --lossless --irot 1 quadrants.png /out/quadrants-irot1.avif >/dev/null
    avifenc --speed 8 --lossless --imir 0 quadrants.png /out/quadrants-imir0.avif >/dev/null
    avifenc --speed 8 --lossless --imir 1 quadrants.png /out/quadrants-imir1.avif >/dev/null
    avifenc --speed 8 --lossless --irot 1 --imir 0 quadrants.png /out/quadrants-irot1-imir0.avif >/dev/null
    # An Exif item with orientation 6 and an irot of a half turn, which
    # disagree; avifenc otherwise turns the Exif orientation into irot.
    printf "MM\0*\0\0\0\10\0\1\1\22\0\3\0\0\0\1\0\6\0\0\0\0\0\0" > orientation6.exif
    avifenc --speed 8 --lossless --exif orientation6.exif --irot 2 quadrants.png /out/quadrants-exif6-irot2.avif >/dev/null
    heif-enc --quality 90 --rotate-cw 90 quadrants.png -o /out/quadrants-rotate-cw90.heic >/dev/null
    chown -R '"$(id -u):$(id -g)"' /out
  '
ls -l e2e/fixtures
