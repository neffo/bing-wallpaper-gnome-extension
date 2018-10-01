#!/bin/bash

glib-compile-schemas schemas/
intltool-extract --type=gettext/glade Settings.ui
xgettext -k -k_ -kN_ -o locale/BingWallpaper.pot Settings.ui.h extension.js prefs.js --from-code=UTF-8

for D in locale/*; do
    if [ -d "${D}" ]; then
        msgfmt -o "${D}/LC_MESSAGES/BingWallpaper.mo" "${D}/LC_MESSAGES/BingWallpaper.po"   # your processing here
    fi
done

rm BingWallpaper@ineffable-gmail.com.zip

zip -r BingWallpaper@ineffable-gmail.com.zip *

zip -d BingWallpaper@ineffable-gmail.com.zip screenshot/* screenshot buildzip.sh Settings.ui.h
