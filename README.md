# GNOME Shell extension - Bing Wallpaper

Bring some color to your GNOME desktop by syncing your desktop and lockscreen wallpapers with today's Microsoft Bing image of the day (the image you see when you visit Bing.com) with this extension. The intention of this extension is to just do what it needs to do and stay out of your way, with a few optional features to improve quality-of-life.

[![Get it on GNOME extensions](/screenshot/get_it_on_gnome_extensions.png)](https://extensions.gnome.org/extension/1262/bing-wallpaper-changer/) [![<3 Sponsor this project on GitHub <3](/screenshot/sponsor.png)](https://github.com/sponsors/neffo)

![Screenshot](/screenshot/overview.jpg)

As featured on [OMG! Ubuntu](https://www.omgubuntu.co.uk/2017/07/bing-wallpaper-changer-gnome-extension). 

Also, check out my related [Google Earth View wallpaper extension](https://github.com/neffo/earth-view-wallpaper-gnome-extension) and the partially-derived [Bing Desktop Wallpaper for Cinnamon](https://cinnamon-spices.linuxmint.com/applets/view/320) applet by Starcross.

## Features

* Automatically sets the Bing [Image of the Day](https://www.microsoft.com/en-us/bing/bing-wallpaper) as both lock screen and desktop wallpapers
* Only attempts to download wallpapers when they have been updated - doesn't poll continuously
* Shuffle/randomise wallpapers at adjustable intervals (including from your stored Bing images)
* Image gallery to view, select and curate stored images
* Optionally delete old images after a week, or you can keep (and curate) them forever
* Override the lockscreen blur (NEW: lockscreen blur is now dynamic!)
* Language support: English (en), German (de), Dutch (nl), Italian (it), Polish (pl), Chinese (zh_CN, zh_TW), French (fr_FR), Portuguese (pt, pt_BR), Ukrainian (uk), Russian (ru_RU), Spanish (es), Korean (ko), Indonesian (id), Catalan (ca), Norwegian Bokmål (nb) & Nynorsk (nn), Swedish (sv), Arabic (ar), Hungarian (hu), Japanese (ja), Czech (cs_CZ), Finnish (fi_FI) and Turkish (tr), Persian (fa_ir) - a HUGE thanks to the translators
* Image preview in menus & ability to manually set wallpapers individually or copy image to clipboard
* A selection of different theme-aware indicator (tray) icons to choose (or hide it completely)

## Quickstart guide

* Install from [GNOME extensions](https://extensions.gnome.org/extension/1262/bing-wallpaper-changer/), by default your wallpaper will be synced to the current Bing image of the day - if that's all you want you don't have to do anymore, everything is automatic
* Bing Wallpaper (by default) builds a collection of images over time (this can be disabled if required)

### Control bar
![Bing Wallpaper menu control bar](/screenshot/controlbar.png)

* 🤍 - Favorite/unfavorite current image (can be used to shuffle only favorite images and favorites are never deleted automatically)
* 🗑️ - Trash/untrash current image (exclude from shuffle selection or optionally deleted from disk)
* ⏪ - select previous day's image (in date order)
* ⏩ - select next day's image (in date order)
* ⏭️ - select today's image (skip to current)
* 🎲 - I'm feeling lucky, show me a random image (by default you should have at least 8 images available, curated with favorite and trash buttons)

### Quick settings
![Bing Wallpaper menu control bar](/screenshot/quicksettings.png)

* Always show new images - when a new Bing wallpaper is available switch to it immediately
* Image shuffle mode - switch to a random image at user defined intervals (default once per day or once per startup)
* Image shuffle only favorites - only select favorite images (🤍), by default 'trashed' images are always excluded
* Image shuffle only UHD resolution - occasionally some images are not UHD, exclude these from selection

### Gallery

![Gallery item](/screenshot/gallery.png)

The 5 buttons in the gallery (3rd page in the preferences) do have tool-tips but these do the following:
- Favorite - favorite this image (equivalent to doing this via the control bar)
- Apply - set this image as wallpaper
- View - open image in image viewer
- Info - open the Bing description of the image
- Trash - trash the image

## TODO

* add more languages (#14) - [please help if you can](https://github.com/neffo/bing-wallpaper-gnome-extension/issues/14)
* add user features requests - [lots have already been implemented](https://github.com/neffo/bing-wallpaper-gnome-extension/issues?q=is%3Aissue+label%3Aenhancement+is%3Aclosed)

## Known Issues

* In China, users are limited to 'Chinese – China', 'English - International' markets (this is the way Bing handles the Chinese market/locale, not an extension 'bug' - sorry!)
* Bing may detect your location incorrectly (and force a locale as above) - if you see this, please let me know what Bing.com itself does
* GNOME Shell themes can break some GNOME popup menu elements (toggle switches for example). This impacts GNOME more generally, not just this extension. Double check you are running latest versions of your themes (or disable them).

## System Requirements

GNOME 3.36+ or 40+ (Ubuntu 20.04 LTS or later, older versions of the extension work with 3.18+, but are no longer supported).

## Package dependencies

Below packages are required to build the extension

```
npm
gettext
intltool
zip
```
For Ubuntu you can hit below command to install
```
sudo apt install npm gettext intltool zip -y
```

## Install

[Install from extensions.gnome.org](https://extensions.gnome.org/extension/1262/bing-wallpaper-changer/)

or install directly to your GNOME extensions directory (useful if you want to hack on it)

```
mkdir ~/Desktop/source
cd ~/Desktop/source
git clone https://github.com/neffo/bing-wallpaper-gnome-extension.git
cd bing-wallpaper-gnome-extension
sh install.sh
```

## Enable debug logging

Enable debug logging through the extension preferences 'Debug options' tab or if unable to open preferences you can enable debugging using dconf-editor with this command:
```
GSETTINGS_SCHEMA_DIR=$HOME/.local/share/gnome-shell/extensions/BingWallpaper@ineffable-gmail.com/schemas dconf-editor /org/gnome/shell/extensions/bingwallpaper/
```

Please include logs from your journal when submitting bug notices (make sure nothing sensitive is included in the text!).

## Screenshots

### Image gallery

![Settings](/screenshot/settings5.png)

### Preferences

![Settings](/screenshot/settings.png)
![Settings](/screenshot/settings2.png)
![Settings](/screenshot/settings3.png)
![Settings](/screenshot/settings4.png)


### Lockscreen blur control
From left to right: 
* no blur/no dimming
* slight blur/default dimming
* default blur/default dimming
![Blur example](/screenshot/blurexample.jpg)

## Toss a coin to your coder

Do you like this extension and want to show that you appreciate the work that goes into adding new features and keeping it maintained? Please consider buying me a coffee on [GitHub Sponsors](https://github.com/sponsors/neffo) or on [Flattr](https://flattr.com/@neffo).

## Disclaimer

This extension is unofficial and not affiliated with Bing or Microsoft in any way. Images are protected by copyright, and are licensed only for use as wallpapers.

## Special Thanks

This extension is based on the NASA APOD extension by [Elinvention](https://github.com/Elinvention)
and inspired by Bing Desktop WallpaperChanger by [Utkarsh Gupta](https://github.com/UtkarshGpta). Lockscreen blur code is based on [Pratap-Kumar's extension](https://github.com/PRATAP-KUMAR/Control_Blur_Effect_On_Lock_Screen). I'd like to give a special shout out to those who have [contributed code and translations](https://github.com/neffo/bing-wallpaper-gnome-extension/graphs/contributors) as well as everyone who has reported bugs or provided feedback and suggestions for improvements. Also, thanks to Microsoft for this great API and wallpaper collection.

## License

This extension is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
