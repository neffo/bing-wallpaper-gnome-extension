# GNOME Shell extension - Bing Wallpaper

A lightweight GNOME shell extension to syncs your desktop wallpaper to today's Microsoft Bing image of the day (the image you see when you visit Bing.com). The intention of this extension is to just do what it needs to do and stay out of your way.

*Disclaimer*: this extension is unofficial and not affiliated with Bing or
Microsoft in any way. Images are protected by copyright, and are licensed only
for use as wallpapers.

This extension is based extensively on the NASA APOD extension by [Elinvention](https://github.com/Elinvention)
and inspired by Bing Desktop WallpaperChanger by [Utkarsh Gupta](https://github.com/UtkarshGpta). As featured on [OMG! Ubuntu](https://www.omgubuntu.co.uk/2017/07/bing-wallpaper-changer-gnome-extension). Lockscreen blur code is based on [Pratap-Kumar's extension.](https://github.com/PRATAP-KUMAR/Control_Blur_Effect_On_Lock_Screen)

Also, check out my related [Google Earth View wallpaper extension](https://github.com/neffo/earth-view-wallpaper-gnome-extension) and the partially-derived [Bing Desktop Wallpaper for Cinnamon](https://github.com/Starcross/bing-wallpaper-cinnamon) by Starcross.

[![Get it on GNOME extensions](/screenshot/get_it_on_gnome_extensions.png)](https://extensions.gnome.org/extension/1262/bing-wallpaper-changer/) [![<3 Sponsor this project on GitHub <3](/screenshot/sponsor.png)](https://github.com/sponsors/neffo)

## Features

![Screenshot](/screenshot/popup.png)

* Fetches the Bing [Image of the Day](https://www.microsoft.com/en-us/bing/bing-wallpaper) and sets as both lock screen (and now it's dialog also) and desktop wallpaper (these are both optional)
* Only attempts to download wallpapers when they have been updated - doesn't poll continuously
* Optionally clean up Wallpaper directory after between 1 and 7 days (delete oldest first), or keep them forever
* Optionally force a specific region (i.e. what Bing calls a "market", some Wallpapers may relate to local holidays or locations)
* Language support: English (en), German (de), Dutch (nl), Italian (it), Polish (pl), Chinese (zh_CN), French (fr_FR), Portuguese (pt, pt_BR), Russian (ru_RU), Spanish (es), Korean (ko, ko_KR, ko_KP), Indonesian (id), Catalan (ca), Norwegian Bokmål (nb) & Nynorsk (ni), Swedish (sv), Arabic (ar) and Hungarian (hu) - a HUGE thanks to the translators
* image preview in menus & ability to manually set wallpapers individually or copy image to clipboard
* a selection of different theme-aware indicator (tray) icons to choose
* override the GNOME (GDM3) lockscreen blur (requested feature #77)
* NEW: image gallery to view, select and manage stored images #115

## TODO

* add more languages (#14) - [please help if you can](https://github.com/neffo/bing-wallpaper-gnome-extension/issues/14)
* add user features requests - [lots have already been implemented](https://github.com/neffo/bing-wallpaper-gnome-extension/issues?q=is%3Aissue+label%3Aenhancement+is%3Aclosed)

## Known Issues

* In China, users are limited to 'Chinese – China', 'English - International' markets (this is the way Bing handles the Chinese market/locale, not an extension 'bug' - sorry!)
* Bing may detect your location incorrectly (and force a locale as above) - if you see this, please let me know what Bing.com itself does

## Requirements

GNOME 3.28+ (Ubuntu Gnome 18.04+, Fedora 23+, older versions of the extension work with 3.18+, but are no longer supported). Blur control requires GNOME 3.36+, and may be unreliable on 3.36.3 or below.

## Install

[Install from extensions.gnome.org](https://extensions.gnome.org/extension/1262/bing-wallpaper-changer/)

or install directly to your GNOME extensions directory (useful if you want to hack on it)

```
git clone https://github.com/neffo/bing-wallpaper-gnome-extension.git $HOME/.local/share/gnome-shell/extensions/BingWallpaper@ineffable-gmail.com
```

or create a zip file by doing this

```
git clone https://github.com/neffo/bing-wallpaper-gnome-extension.git
cd bing-wallpaper-gnome-extension
sh buildzip.sh
```

You can then install this file using the GNOME Tweak Tool. Please note to install an extension correctly the zip must have the metadata.json file in the base directory (not in a sub-directory), so you can't use the Github zip file to do this.

## Enable debug logging

If you run into problems, you can enable debugging using dconf-editor with this command:
```
GSETTINGS_SCHEMA_DIR=$HOME/.local/share/gnome-shell/extensions/BingWallpaper@ineffable-gmail.com/schemas dconf-editor /org/gnome/shell/extensions/bingwallpaper/
```

Please include logs from your journal when submitting bug notices (make sure nothing sensitive is included in the text!).

## Screenshots

![Screenshot](/screenshot/notification.png)

![Settings](/screenshot/settings.png)
![Settings](/screenshot/settings2.png)
![Settings](/screenshot/settings3.png)
![Settings](/screenshot/settings4.png)
![Settings](/screenshot/settings5.png)


Examples of adjustable blur on the lockscreen:
(from left to right: no blur/no dimming, slight blur/default dimming, default blur/default dimming)
![Blur example](/screenshot/blurexample.jpg)

## Toss a coin to your coder

Do you like this extension and want to show that you appreciate the work that goes into adding new features and keeping it maintained? Please consider buying me a coffee on [GitHub Sponsors](https://github.com/sponsors/neffo) or on [Flattr](https://flattr.com/@neffo).

## Special Thanks

I'd like to give a special shout out to those who have [contributed code and translations](https://github.com/neffo/bing-wallpaper-gnome-extension/graphs/contributors) as well as everyone who has reported bugs or provided feedback and suggestions for improvements.

## License

This extension is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
