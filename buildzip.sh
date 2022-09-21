#!/bin/bash

# Missing the below tools won't break the zip build, but this does prevent translatons 
# & schemas being rebuilt (if there are changes). Releases should always be built with
# the tools, but test builds in VMs it (generally) should be ok

glib-compile-schemas schemas/
intltool-extract --type=gettext/glade ui/Settings.ui
intltool-extract --type=gettext/glade ui/Settings4.ui
intltool-extract --type=gettext/glade ui/carousel.ui
intltool-extract --type=gettext/glade ui/carousel4.ui
xgettext -k -k_ -kN_ --omit-header -o locale/BingWallpaper.pot ui/Settings.ui.h ui/Settings4.ui.h ui/carousel.ui.h ui/carousel4.ui.h extension.js prefs.js blur.js utils.js convenience.js --from-code=UTF-8

DATE=`date +"%F"`
echo "# Translation status of statements as at $DATE:" > translations.txt
MSGCOUNT=`cat locale/BingWallpaper.pot | grep -c -e msgid`
for D in locale/*; do
    if [ -d "${D}" ]; then
        msgfmt --template=BingWallpaper.pot --statistics --verbose -o "${D}/LC_MESSAGES/BingWallpaper.mo" "${D}/LC_MESSAGES/BingWallpaper.po"  2>&1 | cat >> translations.txt
        # your processing here
    fi
done

rm BingWallpaper@ineffable-gmail.com.zip

zip -r BingWallpaper@ineffable-gmail.com.zip *

zip -d BingWallpaper@ineffable-gmail.com.zip screenshot/* screenshot *.sh npm-debug.log icons/original/* .* translations.txt *.h package.json *.po *.pot test.js
