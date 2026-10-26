#!/bin/sh
# Move the web screens `cap sync` just copied into the SHARED main/assets folder
# into this app's own Android source set (src/<flavor>/assets), and label it.
#
# Why: both apps are variants of one Android project. With the screens in
# main/assets, whichever app was synced last was inside BOTH — a contractorDebug
# run from Android Studio after a grocery sync installed «دفتر المقاول» with the
# grocery screens in it. Each flavor's own folder makes that impossible, and
# app/build.gradle refuses to build a variant whose folder is missing or wrong.
set -e
flavor="$1"
case "$flavor" in grocery|contractor) ;; *) echo "usage: $0 grocery|contractor" >&2; exit 1 ;; esac

app="$(dirname "$0")/../android/app/src"
dest="$app/$flavor/assets"
rm -rf "$dest"
mkdir -p "$dest"
for f in public capacitor.config.json capacitor.plugins.json; do
  mv "$app/main/assets/$f" "$dest/"
done
echo "$flavor" > "$dest/flavor.txt"
echo "web screens → src/$flavor/assets"
