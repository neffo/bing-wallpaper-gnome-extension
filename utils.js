// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2023 Michael Carroll
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

export var PRESET_GNOME_DEFAULT = { blur: 45, dim: 65 }; // as at GNOME 40
export var PRESET_NO_BLUR = { blur: 0, dim: 65 };
export var PRESET_SLIGHT_BLUR = { blur: 2, dim: 30 };

export var BING_SCHEMA = 'org.gnome.shell.extensions.bingwallpaper';
export var DESKTOP_SCHEMA = 'org.gnome.desktop.background';

var vertical_blur = null;
var horizontal_blur = null;

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

export var BingImageURL = 'https://www.bing.com/HPImageArchive.aspx';
export var BingParams = { format: 'js', idx: '0' , n: '8' , mbl: '1' , mkt: '' } ;

export function validate_icon(settings, extension_path, icon_image = null) {
    BingLog('validate_icon()');
    let icon_name = settings.get_string('icon-name');
    if (icon_name == '' || icon_list.indexOf(icon_name) == -1) {
        settings.reset('icon-name');
        icon_name = settings.get_string('icon-name');
    }
    // if called from prefs
    if (icon_image) { 
        BingLog('set icon to: ' + extension_path + '/icons/' + icon_name + '.svg');
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(extension_path + '/icons/' + icon_name + '.svg', 64, 64);
        icon_image.set_from_pixbuf(pixbuf);
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

export function fetch_change_log(version, label, httpSession) {
    const decoder = new TextDecoder();
    // create an http message
    let url = gitreleaseurl + "v" + version;
    let request = Soup.Message.new('GET', url);
    request.request_headers.append('Accept', 'application/json');
    BingLog("Fetching " + url);
    // queue the http request
    try {
        if (Soup.MAJOR_VERSION >= 3) {
            httpSession.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                let data = decoder.decode(httpSession.send_and_read_finish(message).get_data());
                let text = JSON.parse(data).body;
                label.set_label(text);
            });
        }
        else {
            httpSession.queue_message(request, (httpSession, message) => {
                let data = message.response_body.data;
                let text = JSON.parse(data).body;
                label.set_label(text);
            });
        }
    } 
    catch (error) {
        BingLog("Error fetching change log: " + error);
        label.set_label(_("Error fetching change log: "+error));
    }
}

export function set_blur_preset(settings, preset) {
    settings.set_int('lockscreen-blur-strength', preset.blur);
    settings.set_int('lockscreen-blur-brightness', preset.dim);
    BingLog("Set blur preset to " + preset.blur + " brightness to " + preset.dim);
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

export function getImageList(settings, filter = null) {
    let image_list = JSON.parse(settings.get_string('bing-json'));
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

export function setImageList(settings, imageList) {
    settings.set_string('bing-json', JSON.stringify(imageList));
    if (settings.get_boolean('always-export-bing-json')) { // save copy of current JSON
        exportBingJSON(settings);
    }
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
    return image_data.copyright.replace(/\s*\(.*?\)\s*/g, '');
}

export function getImageUrlBase(image_data) {
    return image_data.urlbase.replace('/th?id=OHR.', '');
}

export function getMaxLongDate(settings) {
    let imageList = getImageList(settings);
    return Math.max.apply(Math, imageList.map(function(o) { return o.fullstartdate; }));
}

export function getCurrentImageIndex (imageList) {
    if (!imageList)
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
        if (urlbase.replace('/th?id=OHR.', '') == x.urlbase.replace('/th?id=OHR.', ''))
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
    let curList = getImageList(settings);
    let newList = []; // list of only new images (for future notifications)
    imageList.forEach(function(x, i) {
        if (!inImageList(curList, x.urlbase)) {// if not in the list, add it
            curList.unshift(x); // use unshift to maintain reverse chronological order
            newList.unshift(x); 
        }
    });
    setImageList(settings, imageListSortByDate(curList)); // sort then save back to settings
    return newList; // return this to caller for notifications
}

export function imageIndex(imageList, urlbase) {
    return imageList.map(p => p.urlbase.replace('/th?id=OHR.', '')).indexOf(urlbase.replace('/th?id=OHR.', ''));
}

export function isFavourite(image) {
    return (image.favourite && image.favourite === true);
}

export function getImageByIndex(imageList, index) {
    if (imageList.length == 0 || index < 0 || index > imageList.length - 1)
        return null;
    return imageList[index];
}

export function cleanupImageList(settings) {
    if (settings.get_boolean('trash-deletes-images') == false)
        return;
    let curList = imageListSortByDate(getImageList(settings));
    let cutOff = GLib.DateTime.new_now_utc().add_days(-8); // 8 days ago
    let newList = [];
    curList.forEach( function (x, i) {
        let filename = imageToFilename(settings, x);
        let diff = dateFromLongDate(x.fullstartdate, 0).difference(cutOff);
        // image is still downloadable (< 8 days old) or still on disk, so we keep
        if (diff > 0 || Gio.file_new_for_path(filename).query_exists(null)) {
            newList.push(x);
        }
        else {
            BingLog('Cleaning up: '+filename);
        }
    });
    setImageList(settings, newList);
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
    let cutOff = GLib.DateTime.new_now_utc().add_days(-8); // 8 days ago
    let dlList = [];
    imageList.forEach( function (x, i) {
        let diff = dateFromLongDate(x.fullstartdate, 0).difference(cutOff);
        let filename = imageToFilename(settings, x);
        // image is still downloadable (< 8 days old) but not on disk
        if (diff > 0 && !Gio.file_new_for_path(filename).query_exists(null)) {
            dlList.push(x);
        }
    });
    return dlList;
}

export function getWallpaperDir(settings) {
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
    return BingWallpaperDir;
}

export function setWallpaperDir(settings, uri) {
    let homeDir =  GLib.get_home_dir();
    let relUri = uri.replace(homeDir, '~');
    settings.set_string('download-folder', relUri);
}

export function imageToFilename(settings, image, resolution = null) {
    return getWallpaperDir(settings) + image.startdate + '-' +
		image.urlbase.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + '_'
		+ (resolution ? resolution : getResolution(settings, image)) + '.jpg';
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
    //const context = global?global.create_app_launch_context(0, -1):null;
    Gio.AppInfo.launch_default_for_uri('file://' + getWallpaperDir(settings), null);
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
    // possible race condition here, need to think about how to fix it
    //let BingWallpaperDir = settings.get_string('download-folder');
    let dir = Gio.file_new_for_path(oldPath);
    let dirIter = dir.enumerate_children('', Gio.FileQueryInfoFlags.NONE, null );
    let newDir = Gio.file_new_for_path(newPath);
    if (!newDir.query_exists(null)) {
        newDir.make_directory_with_parents(null);
    }
    let file = null;
    while (file = dirIter.next_file(null)) {
        let filename = file.get_name(); // we only want to move files that we think we own
        if (filename.match(/\d{8}\-.+\.jpg/i)) {
            BingLog('file: ' + slash(oldPath) + filename + ' -> ' + slash(newPath) + filename);
            let cur = Gio.file_new_for_path(slash(oldPath) + filename);
            let dest = Gio.file_new_for_path(slash(newPath) + filename);
            cur.move(dest, Gio.FileCopyFlags.OVERWRITE, null, function () { BingLog ('...moved'); });
        }
    }
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

// add image to persistant list so we can delete it later (in chronological order), delete the oldest image (if user wants this)
export function purgeImages(settings) {
    let deletepictures = settings.get_boolean('delete-previous');
    let keepfavorites = settings.get_boolean('keep-favourites');
    if (deletepictures === false)
        return;
    let imagelist = imageListSortByDate(getImageList(settings));
    let maxpictures = settings.get_int('previous-days');
    let origlength = imagelist.length;
    while (imagelist.length > maxpictures) {
        var to_delete = imagelist.shift(); // get the first (oldest item from the list)
        var ok_to_delete = keepfavorites && (to_delete.favourite && to_delete.favourite === true);
        if (deletepictures && to_delete != '' && ok_to_delete) {
            let imageFilename = imageToFilename(settings, to_delete);
            BingLog('deleting '+imageFilename);
            deleteImage(imageFilename);
        }
    }
    BingLog('cleaned up image list, count was '+origlength+' now '+imagelist.length);
    cleanupImageList(settings);
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

export function exportBingJSON(settings) {
    let json = settings.get_string('bing-json');
    let filepath = getWallpaperDir(settings) + 'bing.json';
    let file = Gio.file_new_for_path(filepath);
    let [success, error] = file.replace_contents(json, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    if (!success) {
        BingLog('error saving bing-json from '+filepath+': '+error);
    }
}

export function importBingJSON(settings) {
    const decoder = new TextDecoder();
    let filepath = getWallpaperDir(settings) + 'bing.json';
    let file = Gio.file_new_for_path(filepath);
    if (file.query_exists(null)) {
        let [success, contents, etag_out] = file.load_contents(null);
        if (!success) {
            BingLog('error loading bing-json '+filepath+' - '+etag_out);
        }
        else {
            BingLog('JSON import success');
            let parsed = JSON.parse(decoder.decode(contents)); // FIXME: triggers GJS warning without the conversion, need to investigate
            // need to implement some checks for validity here
            mergeImageLists(settings, parsed);
            cleanupImageList(settings); // remove the older missing images
        }
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
