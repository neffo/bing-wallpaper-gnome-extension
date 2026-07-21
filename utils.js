// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2025 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Providers from './providers.js';

export var BING_SCHEMA = 'org.gnome.shell.extensions.bingwallpaper';
export var DESKTOP_SCHEMA = 'org.gnome.desktop.background';

let gitreleaseurl = 'https://api.github.com/repos/neffo/bing-wallpaper-gnome-extension/releases/tags/';
let debug = false;

export var icon_list = ['bing-symbolic', 'brick-symbolic', 'high-frame-symbolic', 'mid-frame-symbolic', 'low-frame-symbolic'];
export var resolutions = ['auto', 'UHD', '1920x1200', '1920x1080', '1366x768', '1280x720', '1024x768', '800x600'];
export var markets = ['auto', 'ar-XA', 'da-DK', 'de-AT', 'de-CH', 'de-DE', 'en-AU', 'en-CA', 'en-GB',
    'en-ID', 'en-IE', 'en-IN', 'en-MY', 'en-NZ', 'en-PH', 'en-SG', 'en-US', 'en-WW', 'en-XA', 'en-ZA', 'es-AR',
    'es-CL', 'es-ES', 'es-MX', 'es-US', 'es-XL', 'et-EE', 'fi-FI', 'fr-BE', 'fr-CA', 'fr-CH', 'fr-FR',
    'he-IL', 'hr-HR', 'hu-HU', 'it-IT', 'ja-JP', 'ko-KR', 'lt-LT', 'lv-LV', 'nb-NO', 'nl-BE', 'nl-NL',
    'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'sl-SL', 'sv-SE', 'th-TH', 'tr-TR', 'uk-UA',
    'zh-CN', 'zh-HK', 'zh-TW'];
export var marketName = [
    'auto', '(شبه الجزيرة العربية‎) العربية', 'dansk (Danmark)', 'Deutsch (Österreich)',
    'Deutsch (Schweiz)', 'Deutsch (Deutschland)', 'English (Australia)', 'English (Canada)',
    'English (United Kingdom)', 'English (Indonesia)', 'English (Ireland)', 'English (India)', 'English (Malaysia)',
    'English (New Zealand)', 'English (Philippines)', 'English (Singapore)', 'English (United States)',
    'English (International)', 'English (Arabia)', 'English (South Africa)', 'español (Argentina)', 'español (Chile)',
    'español (España)', 'español (México)', 'español (Estados Unidos)', 'español (Latinoamérica)', 'eesti (Eesti)',
    'suomi (Suomi)', 'français (Belgique)', 'français (Canada)', 'français (Suisse)', 'français (France)',
    '(עברית (ישראל', 'hrvatski (Hrvatska)', 'magyar (Magyarország)', 'italiano (Italia)', '日本語 (日本)', '한국어(대한민국)',
    'lietuvių (Lietuva)', 'latviešu (Latvija)', 'norsk bokmål (Norge)', 'Nederlands (België)', 'Nederlands (Nederland)',
    'polski (Polska)', 'português (Brasil)', 'português (Portugal)', 'română (România)', 'русский (Россия)',
    'slovenčina (Slovensko)', 'slovenščina (Slovenija)', 'svenska (Sverige)', 'ไทย (ไทย)', 'Türkçe (Türkiye)',
    'українська (Україна)', '中文（中国）', '中文（中國香港特別行政區）', '中文（台灣）'
];

export var backgroundStyle = ['none', 'wallpaper', 'centered', 'scaled', 'stretched', 'zoom', 'spanned']; // this may change in the future

export var randomIntervals = [ {value: 'hourly', title: ('on the hour')},
                        {value: 'daily', title: ('every day at midnight')},
                        {value: 'weekly', title: ('Sunday at midnight')},
                        { value: 'custom', title: ('User defined interval')} ];

export var providerIds = Providers.providerIds;
export var providerNames = Providers.providerNames;
export var BingImageURL = Providers.BingImageURL;
export var BingParams = Providers.BingParams;

export function validate_icon(
    settings,
    extension_path,
    icon_image = null,
    app_icon_image = null
) {
    BingLog('validate_icon()');
    let icon_name = settings.get_string('icon-name');
    if (icon_name == '' || icon_list.indexOf(icon_name) == -1) {
        settings.reset('icon-name');
        icon_name = settings.get_string('icon-name');
    }
    // if called from prefs
    if (icon_image && app_icon_image) {
        BingLog('set icon to: ' + extension_path + '/icons/' + icon_name + '.svg');
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(extension_path + '/icons/' + icon_name + '.svg', 64, 64);
        icon_image.set_from_pixbuf(pixbuf);
        app_icon_image.set_from_pixbuf(pixbuf);
    }
}

export function validate_resolution(settings) {
    let resolution = settings.get_string('resolution');
    if (resolution == '' || resolutions.indexOf(resolution) == -1) // if not a valid resolution
        settings.reset('resolution');
}

export function validate_interval(settings) {
    let index = randomIntervals.map( e => e.value).indexOf(settings.get_string('random-interval-mode'));
    if (index == -1) // if not a valid interval
        settings.reset('random-interval-mode');
}

export function getCurrentProvider(settings) {
    let provider = settings.get_string('provider');
    if (providerIds.indexOf(provider) === -1) {
        settings.reset('provider');
        provider = settings.get_string('provider');
    }
    return provider;
}

function getSystemLocaleInfo() {
    let langNames = GLib.get_language_names();
    // langNames[0] is like 'zh_CN.UTF-8' or 'en_US.UTF-8'
    let parts = langNames[0].split('.')[0].split('_');
    let lang = parts[0] || 'en';
    let country = parts[1] || 'US';
    return {
        locale: lang + '-' + country,
        country: country.toUpperCase(),
    };
}

export function getResolvedSpotlightCountry(settings) {
    if (settings.get_string('spotlight-mode') === 'auto')
        return getSystemLocaleInfo().country;
    let country = settings.get_string('spotlight-country').trim();
    return country ? country.toUpperCase() : 'US';
}

export function getResolvedSpotlightLocale(settings) {
    if (settings.get_string('spotlight-mode') === 'auto')
        return getSystemLocaleInfo().locale;
    let locale = settings.get_string('spotlight-locale').trim();
    return locale || 'en-US';
}

export function normalizeSpotlightCountry(settings) {
    let country = settings.get_string('spotlight-country').trim();
    if (country === '') {
        settings.reset('spotlight-country');
        return settings.get_string('spotlight-country');
    }
    let upper = country.toUpperCase();
    if (upper !== settings.get_string('spotlight-country'))
        settings.set_string('spotlight-country', upper);
    return upper;
}

export function normalizeSpotlightLocale(settings) {
    let locale = settings.get_string('spotlight-locale').trim();
    if (locale === '') {
        settings.reset('spotlight-locale');
        return settings.get_string('spotlight-locale');
    }
    if (locale !== settings.get_string('spotlight-locale'))
        settings.set_string('spotlight-locale', locale);
    return locale;
}

export function normalizeImageRecord(image) {
    let normalized = { ...image };
    normalized.provider = normalized.provider ? normalized.provider : Providers.PROVIDER_BING;
    normalized.directurl = normalized.directurl ? normalized.directurl : '';
    normalized.title = normalized.title ? normalized.title :
        (normalized.copyright ? normalized.copyright.replace(/\s*[\(\（].*?[\)\）]\s*/g, '') : '');

    if (!normalized.copyrightText) {
        let match = normalized.copyright ? normalized.copyright.match(/[\(\（]([^)]+)[\)\）]/) : null;
        normalized.copyrightText = match ? match[1].replace('**', '') : '';
    }

    if (!normalized.copyright) {
        if (normalized.title && normalized.copyrightText)
            normalized.copyright = normalized.title + ' (' + normalized.copyrightText + ')';
        else
            normalized.copyright = normalized.title || normalized.copyrightText || '';
    }

    if (!normalized.copyrightlink)
        normalized.copyrightlink = '';

    return normalized;
}

export function getAllImageList(settings) {
    let image_list = JSON.parse(settings.get_string('bing-json'));
    return image_list.map(normalizeImageRecord);
}

function providerMatches(image, provider) {
    return normalizeImageRecord(image).provider === provider;
}

function imageMatchesIdentity(image, urlbase, provider = null) {
    let normalized = normalizeImageRecord(image);
    let imageProvider = provider ? provider : normalized.provider;
    return normalized.provider === imageProvider &&
        getImageUrlBase(normalized) === getImageUrlBase({ urlbase: urlbase });
}

// FIXME: needs work
export function validate_imagename(settings) {
    let filename = settings.get_string('selected-image');

    if (filename != 'current' || filename != 'random') // FIXME: remove this when we move to new shuffle mode
        return;

    if (!inImageList(getImageList(settings), filename)) {
        BingLog('invalid image selected');
        //settings.reset('selected-image');
        settings.set_string('selected-image', 'current');
    }
}

export function get_current_bg(schema) {
    let gsettings = new Gio.Settings({ schema: schema });
    let cur = gsettings.get_string('picture-uri');
    return (cur);
}

export async function fetch_change_log(version, label, httpSession) {
    const decoder = new TextDecoder();
    // create an http message
    let url = gitreleaseurl + "v" + version;
    let request = Soup.Message.new('GET', url);
    request.request_headers.append('Accept', 'application/json');
    BingLog("Fetching " + url);
    // queue the http request
    try {
        if (Soup.MAJOR_VERSION >= 3) {
            await httpSession.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                let data = decoder.decode(httpSession.send_and_read_finish(message).get_data());
                let text = JSON.parse(data).body;
                if (text)
                    label.set_label(text);
            });
        }
        else {
            httpSession.queue_message(request, (httpSession, message) => {
                let data = message.response_body.data;
                let text = JSON.parse(data).body;
                if (text)
                    label.set_label(text);
            });
        }
    }
    catch (error) {
        BingLog("Error fetching change log: " + error);
        label.set_label(_("Error fetching change log: "+error));
    }
}

export function imageHasBasename(image_item, i, b) {
    //log("imageHasBasename : " + image_item.urlbase + " =? " + this);
    if (this && this.search(image_item.urlbase.replace('th?id=OHR.', '')))
        return true;
    return false;
}

export function dateFromLongDate(longdate, add_seconds) {
    if (typeof longdate === 'number')
        longdate = longdate.toString();
    return GLib.DateTime.new(GLib.TimeZone.new_utc(),
                             parseInt(longdate.substr(0, 4)), // year
                             parseInt(longdate.substr(4, 2)), // month
                             parseInt(longdate.substr(6, 2)), // day
                             parseInt(longdate.substr(8, 2)), // hour
                             parseInt(longdate.substr(10, 2)), // mins
                             0 ).add_seconds(add_seconds); // seconds
}

export function dateFromShortDate(shortdate) {
    if (typeof shortdate === 'number')
        shortdate = shortdate.toString();
    return GLib.DateTime.new(GLib.TimeZone.new_utc(),
                             parseInt(shortdate.substr(0, 4)), // year
                             parseInt(shortdate.substr(4, 2)), // month
                             parseInt(shortdate.substr(6, 2)), // day
                             0, 0, 0 );
}

export function getImageList(settings, filter = null, provider = null) {
    let activeProvider = provider ? provider : getCurrentProvider(settings);
    let image_list = getAllImageList(settings).filter(x => providerMatches(x, activeProvider));
    if (!filter) {
        return image_list;
    }
    else {
        return image_list.filter((x, i) => {
            if (filter.faves && !x.favourite)
                return false;
            if (filter.min_height && x.height < filter.min_height)
                return false;
            if (filter.hidden && x.hidden)
                return false;
            return true;
        });
    }
}

export function setAllImageList(settings, imageList) {
    settings.set_string('bing-json', JSON.stringify(imageList.map(normalizeImageRecord)));
    if (settings.get_boolean('always-export-bing-json')) { // save copy of current JSON
        exportBingJSON(settings);
    }
}

export function setImageList(settings, imageList, provider = null) {
    let activeProvider = provider ? provider : getCurrentProvider(settings);
    let otherImages = getAllImageList(settings).filter(x => !providerMatches(x, activeProvider));
    setAllImageList(settings, otherImages.concat(imageList.map(normalizeImageRecord)));
}

export function setImageHiddenStatus(settings, hide_image, hide_status) {
    // get current image list
    let image_list = getImageList(settings);
    log ('image count = '+image_list.length+', hide_image = '+hide_image);
    image_list.forEach( (x, i) => {
        if (hide_image.includes(x.urlbase)) {
            // mark as hidden
            x.hidden = hide_status;
        }
    });
    // export image list back to settings
    setImageList(settings, image_list);
}

export function getImageTitle(image_data) {
    let image = normalizeImageRecord(image_data);
    if (image.title)
        return image.title;
    return image.copyright.replace(/\s*\(.*?\)\s*/g, '');
}

export function getImageCopyrightText(image_data) {
    let image = normalizeImageRecord(image_data);
    if (image.copyrightText)
        return image.copyrightText;
    return image.copyright;
}

export function getImageUrlBase(image_data) {
    return image_data.urlbase.replace('/th?id=OHR.', '');
}

export function getMaxLongDate(settings) {
    let imageList = getImageList(settings);
    if (imageList.length === 0)
        return null;
    return Math.max.apply(Math, imageList.map(function(o) { return o.fullstartdate; }));
}

export function getCurrentImageIndex (imageList) {
    if (!imageList || imageList.length === 0)
        return -1;
    let maxLongDate = Math.max.apply(Math, imageList.map(function(o) { return o.fullstartdate; }));
    let index = imageList.map(p => parseInt(p.fullstartdate)).indexOf(maxLongDate);
    BingLog('getCurrentImageIndex for ' + maxLongDate + ': ' + index);
    return index;
}

export function setImageFavouriteStatus(settings, imageURL, newState) {
    BingLog('set favourite status of '+imageURL+' to '+newState);
    let imageList = getImageList(settings);
    imageList.forEach(function(x, i) {
        //log('testing: '+imageURL+' includes '+x.urlbase);
        if (imageURL.includes(x.urlbase)) {
            BingLog('setting index '+i+' to '+newState?'true':'false');
            imageList[i].favourite = newState;
        }
    });
    setImageList(settings, imageList); // save back to settings
}

export function getCurrentImage(imageList) {
    if (!imageList || imageList.length == 0)
        return null;
    let index = getCurrentImageIndex(imageList);
    if (index == -1)
        return imageList[0]; // give something sensible
    return imageList[index];
}

export function inImageList(imageList, urlbase) {
    let image = null;
    imageList.forEach(function(x, i) {
        if (imageMatchesIdentity(x, urlbase))
            image = x;
    });
    return image;
}

export function inImageListByTitle(imageList, title) {
    let image = null;
    imageList.forEach(function(x, i) {
        BingLog('inImageListbyTitle(): ' + title + ' == ' + getImageTitle(x));
        if (getImageTitle(x) == title)
            image = x;
    });
    return image;
}

export function mergeImageLists(settings, imageList) {
    let curList = getAllImageList(settings);
    let newList = []; // list of only new images (for future notifications)
    imageList.forEach(function(x, i) {
        let normalized = normalizeImageRecord(x);
        if (!curList.some(cur => imageMatchesIdentity(cur, normalized.urlbase, normalized.provider))) {
            curList.unshift(normalized); // use unshift to maintain reverse chronological order
            newList.unshift(normalized);
        }
    });
    setAllImageList(settings, imageListSortByDate(curList)); // sort then save back to settings
    return newList; // return this to caller for notifications
}

export function imageIndex(imageList, urlbase) {
    return imageList.map(p => getImageUrlBase(p)).indexOf(getImageUrlBase({ urlbase: urlbase }));
}

export function isFavourite(image) {
    return (image.favourite && image.favourite === true);
}

export function getImageByIndex(imageList, index) {
    if (imageList.length == 0 || index < 0 || index > imageList.length - 1)
        return null;
    return imageList[index];
}

export function populateImageListResolutions(settings) {
    let curList = imageListSortByDate(getImageList(settings));
    let newList = [];
    curList.forEach( function (x, i) {
        let filename = imageToFilename(settings, x);
        let width, height;
        if (!x.width || !x.height) {
            [width, height] = getFileDimensions(filename);
            x.width = width;
            x.height = height;
        }
        newList.push(x);
    });
    setImageList(settings, newList);
}

export function getFetchableImageList(settings) {
    let imageList = getImageList(settings);
    let provider = getCurrentProvider(settings);
    let maxpictures = settings.get_int('previous-days');
    let maxdownload = 8;
    if (maxpictures < maxdownload && maxpictures >=1)
        maxdownload = maxpictures;
    let cutOff = GLib.DateTime.new_now_utc().add_days(-maxdownload); // default 8 days ago, 1 day = 1 picture
    let dlList = [];
    imageList.forEach( function (x, i) {
        let filename = imageToFilename(settings, x);
        let shouldFetch = true;
        if (provider === Providers.PROVIDER_BING) {
            let diff = dateFromLongDate(x.fullstartdate, 0).difference(cutOff);
            shouldFetch = diff > 0;
        }
        if (shouldFetch && !Gio.file_new_for_path(filename).query_exists(null)) {
            dlList.push(x);
        }
    });
    return dlList;
}

export function getWallpaperRootDir(settings) {
    let homeDir =  GLib.get_home_dir();
    let BingWallpaperDir = settings.get_string('download-folder').replace('~', homeDir);
    let userPicturesDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
    let userDesktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP); // seems to be a safer default
    if (BingWallpaperDir == '') {
        BingWallpaperDir = (userPicturesDir?userPicturesDir:userDesktopDir) + '/BingWallpaper/';
        BingLog('Using default download folder: ' + BingWallpaperDir);
        setWallpaperDir(settings, BingWallpaperDir);
    }
    else if (!BingWallpaperDir.endsWith('/')) {
        BingWallpaperDir += '/';
    }

    let dir = Gio.file_new_for_path(BingWallpaperDir);
    if (!dir.query_exists(null)) {
        dir.make_directory_with_parents(null);
    }
    //FIXME: test if dir is good and writable
    if (dir.query_exists(null))
        return BingWallpaperDir;
    else
        return null;
}

export function getWallpaperDir(settings, provider = null) {
    let activeProvider = provider ? provider : getCurrentProvider(settings);
    let wallpaperDir = slash(getWallpaperRootDir(settings)) + activeProvider + '/';
    let dir = Gio.file_new_for_path(wallpaperDir);
    if (!dir.query_exists(null))
        dir.make_directory_with_parents(null);
    return wallpaperDir;
}

export function setWallpaperDir(settings, uri) {
    let homeDir =  GLib.get_home_dir();
    let relUri = uri.replace(homeDir, '~');
    settings.set_string('download-folder', relUri);
}

export function imageToFilename(settings, image, resolution = null) {
    let normalized = normalizeImageRecord(image);
    let filenameSuffix = resolution ? resolution :
        (normalized.provider === Providers.PROVIDER_BING ? getResolution(settings, normalized) : normalized.provider);
    return getWallpaperDir(settings, normalized.provider) + normalized.startdate + '-' +
		normalized.urlbase.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + '_'
		+ filenameSuffix + '.jpg';
}

export function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

// Utility function
export function dump(object, level = 0) {
    let output = '';
    for (let property in object) {
        output += ' - '.repeat(level)+property + ': ' + object[property]+'\n ';
		if ( typeof object[property] === 'object' )
			output += dump(object[property], level+1);
    }
	if (level == 0)
		BingLog(output);
    return(output);
}

export function friendly_time_diff(time, short = true) {
    // short we want to keep ~4-5 characters
    let now = GLib.DateTime.new_now_local().to_unix();
    let seconds = time.to_unix() - now;

    if (seconds <= 0) {
        return "now";
    }
    else if (seconds < 60) {
        return "< 1 " + (short ? "m" : _("minutes"));
    }
    else if (seconds < 3600) {
        return Math.round(seconds / 60) + " " + (short ? "m" : _("minutes"));
    }
    else if (seconds > 86400) {
        return Math.round(seconds / 86400) + " " + (short ? "d" : _("days"));
    }
    else {
        return Math.round(seconds / 3600) + " " + (short ? "h" : _("hours"));
    }
}

export function seconds_until(until) {
    let now = GLib.DateTime.new_now_local();
    let end, day;
    if (until == 'hourly') {
        end = GLib.DateTime.new_local(
            now.get_year(),
            now.get_month(),
            now.get_day_of_month(),
            now.get_hour()+1, // should roll over to next day if results in >23
            0, 0);
    }
    else {
        if (until == 'weekly') {
            day = now.add_days(7 - now.get_day_of_week());
        }
        else {
            day = now.add_days(1);
        }
        end = GLib.DateTime.new_local(
            day.get_year(),
            day.get_month(),
            day.get_day_of_month(),
            0, 0, 0); // midnight
    }
    BingLog('shuffle timer will be set to '+end.format_iso8601());
    return(Math.floor(end.difference(now)/1000000)); // difference in μs -> s
}

export function getResolution(settings, image) {
    let resolution = settings.get_string('resolution');
    if (resolutions.indexOf(resolution) == -1 || (image ? image.wp == false : true) || // wp == false when background is animated
		settings.get_string('resolution') == 'auto' ) {
        // resolution invalid, animated background or autoselected
        resolution = 'UHD';
    }
    return resolution;
}

export function openImageFolder(settings) {
    Gio.AppInfo.launch_default_for_uri('file://' + getWallpaperDir(settings), null);
}

export function openWallpaperRootFolder(settings) {
    Gio.AppInfo.launch_default_for_uri('file://' + getWallpaperRootDir(settings), null);
}

export function imageListSortByDate(imageList) {
    return imageList.sort(function(a, b) {
        var x = parseInt(a.fullstartdate); var y = parseInt(b.fullstartdate);
        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}

export function shortenName(string, limit) {
    if (string.length > limit) {
        string = string.substr(0, limit - 4) + '...';
    }
    return string;
}

export function moveImagesToNewFolder(settings, oldPath, newPath) {
    let moveProviderDir = (subdir, defaultSubdir = subdir) => {
        let sourceDir = Gio.file_new_for_path(slash(oldPath) + subdir);
        if (!sourceDir.query_exists(null))
            return;
        let destDir = Gio.file_new_for_path(slash(newPath) + defaultSubdir);
        if (!destDir.query_exists(null))
            destDir.make_directory_with_parents(null);

        let dirIter = sourceDir.enumerate_children('', Gio.FileQueryInfoFlags.NONE, null);
        let file = null;
        while (file = dirIter.next_file(null)) {
            let filename = file.get_name();
            if (filename.match(/\d{8}\-.+\.jpg/i)) {
                let cur = Gio.file_new_for_path(slash(oldPath) + subdir + '/' + filename);
                let dest = Gio.file_new_for_path(slash(newPath) + defaultSubdir + '/' + filename);
                BingLog('file: ' + cur.get_path() + ' -> ' + dest.get_path());
                cur.move(dest, Gio.FileCopyFlags.OVERWRITE, null, function () { BingLog ('...moved'); });
            }
        }
    };

    let rootDir = Gio.file_new_for_path(oldPath);
    if (rootDir.query_exists(null)) {
        let dirIter = rootDir.enumerate_children('', Gio.FileQueryInfoFlags.NONE, null);
        let file = null;
        let bingDir = Gio.file_new_for_path(slash(newPath) + Providers.PROVIDER_BING);
        if (!bingDir.query_exists(null))
            bingDir.make_directory_with_parents(null);
        while (file = dirIter.next_file(null)) {
            let filename = file.get_name();
            if (filename.match(/\d{8}\-.+\.jpg/i)) {
                let cur = Gio.file_new_for_path(slash(oldPath) + filename);
                let dest = Gio.file_new_for_path(slash(newPath) + Providers.PROVIDER_BING + '/' + filename);
                BingLog('file: ' + cur.get_path() + ' -> ' + dest.get_path());
                cur.move(dest, Gio.FileCopyFlags.OVERWRITE, null, function () { BingLog ('...moved'); });
            }
        }
    }

    moveProviderDir(Providers.PROVIDER_BING);
    moveProviderDir(Providers.PROVIDER_SPOTLIGHT);

    // correct filenames for GNOME backgrounds
    if (settings.get_boolean('set-background'))
        moveBackground(oldPath, newPath, DESKTOP_SCHEMA);
}

export function dirname(path) {
    return path.match(/.*\//);
}

export function slash(path) {
    if (!path.endsWith('/'))
        return path += '/';
    return path;
}

export function moveBackground(oldPath, newPath, schema) {
    let gsettings = new Gio.Settings({schema: schema});
    let uri = gsettings.get_string('picture-uri');
    gsettings.set_string('picture-uri', uri.replace(oldPath, newPath));
    try {
        let dark_uri = gsettings.get_string('picture-uri-dark');
		gsettings.set_string('picture-uri-dark', dark_uri.replace(oldPath, newPath));
	}
	catch (e) {
		BingLog('no dark background gsettings key found ('+e+')');
	}
    Gio.Settings.sync();
    gsettings.apply();
}

export function BingLog(msg) {
    if (debug)
        print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
}

export function deleteImage(to_delete) {
    var file = Gio.file_new_for_path(to_delete);
    if (file.query_exists(null)) {
        try {
            file.delete(null);
            BingLog("deleted file: " + to_delete);
        }
        catch (error) {
            BingLog("an error occured deleting " + to_delete + " : " + error);
        }
    }
}

// optionally purge trashed images (default is not, these just don't get select in random mode), optionally purge older images
export function purgeImages(settings) {
    let deleteprevious = settings.get_boolean('delete-previous');
    let keepfavourites = settings.get_boolean('keep-favourites');
    let emptytrash = settings.get_boolean('trash-deletes-images');
    let maxDays = settings.get_int('previous-days');
    BingLog('purgeImages() dp: '+(deleteprevious?'true':'false')+'days:'+maxDays+' favs: '+(keepfavourites?'true':'false')+' trash: '+(emptytrash?'true':'false'));

    /*if (deleteprevious === false)
        return;*/
    let imagelist = imageListSortByDate(getImageList(settings));
    let origlength = imagelist.length;
    let cutOff = GLib.DateTime.new_now_utc().add_days(-maxDays); // 8 days ago
    let newList = [];
    imagelist.forEach( function (image, i) {
        var diff = dateFromLongDate(image.fullstartdate, 0).difference(cutOff); // relative age of image, < 0 we can delete
        // always keep favourites, keep images that are less than minimum period (previous days) or if clean up delete previous is disabled (default)
        var keep_image = (keepfavourites && image.favourite && image.favourite === true) || diff > 0 || !deleteprevious;
        var ok_to_delete = !keep_image || (emptytrash && image.hidden);
        var imageFilename = imageToFilename(settings, image);

        if (emptytrash && image.hidden && diff < 0)
            ok_to_delete = true;


        if (deleteprevious && image != '' && ok_to_delete) {
            BingLog('deleting '+imageFilename);
            deleteImage(imageFilename);
        }
        else {
            BingLog('keeping '+imageFilename);
            newList.push(image);
        }
    });
    setImageList(settings, newList);
    BingLog('cleaned up image list, count was '+origlength+' now '+imagelist.length);
    //cleanupImageList(settings);
    validate_imagename(settings); // if we deleted our current image, we want to reset it to something valid
}

export function openInSystemViewer(filename, is_file = true) {
    let context;
    try {
        context = global.create_app_launch_context(0, -1);
    }
    catch (error) {
        context = null;
    }
    if (is_file)
        filename = 'file://'+filename;
    Gio.AppInfo.launch_default_for_uri(filename, context);
}

export async function exportBingJSON(settings) {
    let json = JSON.stringify(getAllImageList(settings));
    let filepath = getWallpaperRootDir(settings) + 'bing.json';
    let file = Gio.file_new_for_path(filepath);

    const [etag] = await file.replace_contents_async(
        json,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null,
        (file, res) => {
            try {
                file.replace_contents_finish(res);
            }
            catch(e) {
                BingLog('error saving bing-json from '+filepath+': '+e);
            }
        }
    );
}

export async function importBingJSON(settings) {
    const decoder = new TextDecoder();
    let filepath = getWallpaperRootDir(settings) + 'bing.json';
    let file = Gio.file_new_for_path(filepath);
    if (file.query_exists(null)) {
        const [contents, etag] = await file.load_contents_async(null,
            (file, res) => {
                try {
                    BingLog('JSON import success');
                    let parsed = JSON.parse(decoder.decode(contents)); // FIXME: triggers GJS warning without the conversion, need to investigate
                    // need to implement some checks for validity here
                    mergeImageLists(settings, parsed.map(normalizeImageRecord));
                    purgeImages(settings); // remove the older missing images
                    file.load_contents_finish(res);
                }
                catch (e) {
                    BingLog('error loading bing-json '+filepath+' - '+e);
                }
            }
        );
    }
    else {
        BingLog('JSON import file not found');
    }
}

export function getFileDimensions(filepath) {
    let format, width, height;
    try {
        [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(filepath);
        return [width, height];
    }
    catch (e) {
        BingLog('unable to getFileDimensions('+filepath+') '+e);
        return [null, null];
    }

}

export function toFilename(wallpaperDir, startdate, imageURL, resolution) {
    return wallpaperDir + startdate + '-' + imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + '_' + resolution + '.jpg';
}
