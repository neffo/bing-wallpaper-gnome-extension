#!/bin/sh
SCRIPTDIR=`dirname $0`
xgettext  --from-code=UTF-8 -k_ -kN_  -o BingWallpaper.pot "$SCRIPTDIR"/../*.js "$SCRIPTDIR"/../schemas/*.xml "$SCRIPTDIR" /../ui/*.*

for fn in ./*/LC_MESSAGES/*.po; do
	msgmerge -U "$fn" BingWallpaper.pot
done
