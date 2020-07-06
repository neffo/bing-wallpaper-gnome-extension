# GNOME Shell extension - Bing Wallpaper

A lightweight GNOME shell extension to syncs your desktop wallpaper to today's Microsoft Bing image of the day (the image you see when you visit Bing.com). The intention of this extension is to just do what it needs to do and stay out of your way.

*Disclaimer*: this extension is unofficial and not affiliated with Bing or
Microsoft in any way. Images are protected by copyright, and are licensed only
for use as wallpapers.

This extension is based extensively on the NASA APOD extension by [Elinvention](https://github.com/Elinvention)
and inspired by Bing Desktop WallpaperChanger by [Utkarsh Gupta](https://github.com/UtkarshGpta).

Also, check out my related [Google Earth View wallpaper extension](https://github.com/neffo/earth-view-wallpaper-gnome-extension).

## Features

![Screenshot](/screenshot/popup.png)

* Fetches the Bing wallpaper of the day and sets as both lock screen (and now it's dialog also) and desktop wallpaper (these are both optional)
* Optionally force a specific region (i.e. what Bing calls a "market", some Wallpapers may relate to local holidays or locations)
* Automatically selects the highest resolution (and most appropriate wallpaper) in multiple monitor setups
* Optionally clean up Wallpaper directory after between 1 and 7 days (delete oldest first), or keep them forever
* Only attempts to download wallpapers when they have been updated
* Doesn't poll continuously - only once per day and on startup (a refresh is scheduled when Bing is due to update)
* Language support: English (en), German (de), Dutch (nl), Italian (it), Polish (pl), Chinese (zh_CN), French (fr_FR), Portugeuse (pt, pt_BR), Russian (ru_RU), Spanish (es), Korean (ko, ko_KR, ko_KP), Indonesian (id), Catalan (ca) and Norwegian Bokmål & Nynorsk - a HUGE thanks to the translators
* NEW: image preview in menus & ability to manually set desktop and lockscreen wallpapers individually
* NEW: copy image to clipboard
* NEW: a selection of different indicator (tray) icons to choose

## TODO

* add more languages (#14) - [please help if you can](https://github.com/neffo/bing-wallpaper-gnome-extension/issues/14)
* fix/test HTTP(S) proxy support (#22)

## Known Issues

* In China, users are limited to 'Chinese – China', 'English - International' markets (this is the way Bing handles the Chinese market/locale, not an extension 'bug' - sorry!)
* Bing may detect your location incorrectly (and force a locale as above) - if you see this, please let me know what Bing.com itself does

## Requirements

Gnome 3.28+ (Ubuntu Gnome 18.04+, Fedora 23+, older versions of the extension work with 3.18+, but are no longer supported)

## Install

[Install from extensions.gnome.org](https://extensions.gnome.org/extension/1262/bing-wallpaper-changer/)

or install directly to your GNOME extensions directory (useful if you want to hack on it)

`git clone https://github.com/neffo/bing-wallpaper-gnome-extension.git $HOME/.local/share/gnome-shell/extensions/BingWallpaper@ineffable-gmail.com`

or create a zip file by doing this

`git clone https://github.com/neffo/bing-wallpaper-gnome-extension.git`
`cd bing-wallpaper-gnome-extension`
`sh buildzip.sh`

You can then install this file using the Gnome Tweak Tool. Please note to install an extension correctly the zip must have the metadata.json file in the base directory (not in a sub-directory), so you can't use the Git zip file to do this.

Heres a suitable [zip file](https://neffo.github.io/BingWallpaper@ineffable-gmail.com.zip) I prepared earlier.

## Screenshots

![Screenshot](/screenshot/notification.png)

![Settings](/screenshot/settings.png)

## Toss a coin to your coder

Do you like this extension and want to show that you appreciate the work that goes into adding new features and keeping it maintained? Please consider buying me a coffee at [Flattr](https://flattr.com/@neffo).

## Special Thanks

I'd like to give a special shout out to those who have [contributed code and translations](https://github.com/neffo/bing-wallpaper-gnome-extension/graphs/contributors) as well as everyone who has reported bugs or provided feedback and suggestions for improvements.