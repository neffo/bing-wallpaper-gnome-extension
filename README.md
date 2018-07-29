# GNOME Shell extension - Bing Wallpaper Changer

Lightweight GNOME shell extension to change your wallpaper every day to
Microsoft Bing's wallpaper (the image you see when you visit Bing.com). It will
also show a notification containing the title and the explanation of the image.

*Disclaimer*: this extension is unofficial and not affiliated with Bing or
Microsoft in any way. Images are protected by copyright, and are licensed only
for use as wallpapers.

This extension is based extensively on the NASA APOD extension by [Elinvention](https://github.com/Elinvention)
and inspired by Bing Desktop WallpaperChanger by [Utkarsh Gupta](https://github.com/UtkarshGpta).

This is my first attempt at a GNOME extension, so it may have some issues.

## Features

* Fetches the Bing wallpaper of the day and sets as both lock screen and desktop wallpaper (these are both user selectable)
* Optionally force a specific region (i.e. what Bing calls a "market", some Wallpapers may relate to local holidays or locations)
* Automatically selects the highest resolution (and most appropriate wallpaper) in multiple monitor setups
* Optionally clean up Wallpaper directory after between 1 and 7 days (delete oldest first), or keep them forever
* Only attempts to download wallpapers when they have been updated
* Doesn't poll continuously - only once per day and on startup (a refresh is scheduled when Bing is due to update)
* Language support: English, German (de), Dutch (nl), Italian (it), Polish (pl), Chinese (zh_CN), French (fr_FR), Portugeuse (pt, pt_BR), Russian (ru_RU), Spanish (es) language translations (a HUGE thanks to the translators)

## TODO

* add more languages (#14) - [please help if you can](https://github.com/neffo/bing-wallpaper-gnome-extension/issues/14)
* fix/test HTTP(S) proxy support (#22)

## Known Issues

* In China, users are limited to 'Chinese – China', 'English - International' markets (this is the way Bing handles the Chinese market/locale, not an extension 'bug' - sorry)
* Bing may detect your location incorrectly (and force a locale as above) - if you see this, please let me know what Bing.com itself does
* Some users see a GNOME shell crash (this seems to be a GNOME bug though...) (#17) - this may be fixed on current Gnome release however
* We are limited by the resolution of Bing's wallpapers, so no 4K options yet

## Requirements

Gnome 3.18+ (Ubuntu Gnome 16.04+, Fedora 23+)

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
