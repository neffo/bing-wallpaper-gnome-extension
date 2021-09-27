#!/bin/bash

glib-compile-schemas schemas/
intltool-extract --type=gettext/glade ui/Settings.ui
intltool-extract --type=gettext/glade ui/Settings4.ui
intltool-extract --type=gettext/glade ui/carousel.ui
intltool-extract --type=gettext/glade ui/carousel4.ui
xgettext -k -k_ -kN_ -o locale/BingWallpaper.pot Settings.ui.h Settings4.ui.h extension.js prefs.js blur.js utils.js convenience.js carousel.ui carousel4.ui --from-code=UTF-8

echo "Translation status" > translations.txt
for D in locale/*; do
    if [ -d "${D}" ]; then
        msgfmt --template=BingWallpaper.pot --statistics --verbose -o "${D}/LC_MESSAGES/BingWallpaper.mo" "${D}/LC_MESSAGES/BingWallpaper.po"  2>> translations.txt 
        # your processing here
    fi
done

rm BingWallpaper@ineffable-gmail.com.zip

zip -r BingWallpaper@ineffable-gmail.com.zip *

zip -d BingWallpaper@ineffable-gmail.com.zip screenshot/* screenshot *.sh npm-debug.log icons/original/* .* translations.txt *.h package.json *.po *.pot
