// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2023 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

const {Gio, GLib, Soup, GdkPixbuf} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Config = imports.misc.config;
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;
const ByteArray = imports.byteArray;

var PRESET_GNOME_DEFAULT = { blur: 60, dim: 55 }; // as at GNOME 40
var PRESET_NO_BLUR = { blur: 0, dim: 60 }; 
var PRESET_SLIGHT_BLUR = { blur: 2, dim: 60 }; 

var BING_SCHEMA = 'org.gnome.shell.extensions.bingwallpaper';
var DESKTOP_SCHEMA = 'org.gnome.desktop.background';
var LOCKSCREEN_SCHEMA = 'org.gnome.desktop.screensaver';

var shellVersionMajor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[0]);
var shellVersionMinor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[1]); //FIXME: these checks work will probably break on newer shell versions
var shellVersionPoint = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[2]);

var vertical_blur = null;
var horizontal_blur = null;

let gitreleaseurl = 'https://api.github.com/repos/neffo/bing-wallpaper-gnome-extension/releases/tags/';
let debug = true;

// remove this when dropping support for < 3.33, see https://github.com/OttoAllmendinger/
var getActorCompat = (obj) =>
    Convenience.currentVersionGreaterEqual('3.33') ? obj : obj.actor;

var icon_list = ['bing-symbolic', 'brick-symbolic', 'high-frame-symbolic', 'mid-frame-symbolic', 'low-frame-symbolic'];
var resolutions = ['auto', 'UHD', '1920x1200', '1920x1080', '1366x768', '1280x720', '1024x768', '800x600'];
var markets = ['auto', 'ar-XA', 'da-DK', 'de-AT', 'de-CH', 'de-DE', 'en-AU', 'en-CA', 'en-GB',
    'en-ID', 'en-IE', 'en-IN', 'en-MY', 'en-NZ', 'en-PH', 'en-SG', 'en-US', 'en-WW', 'en-XA', 'en-ZA', 'es-AR',
    'es-CL', 'es-ES', 'es-MX', 'es-US', 'es-XL', 'et-EE', 'fi-FI', 'fr-BE', 'fr-CA', 'fr-CH', 'fr-FR',
    'he-IL', 'hr-HR', 'hu-HU', 'it-IT', 'ja-JP', 'ko-KR', 'lt-LT', 'lv-LV', 'nb-NO', 'nl-BE', 'nl-NL',
    'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'sl-SL', 'sv-SE', 'th-TH', 'tr-TR', 'uk-UA',
    'zh-CN', 'zh-HK', 'zh-TW'];
var marketName = [
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
var backgroundStyle = ['none', 'wallpaper', 'centered', 'scaled', 'stretched', 'zoom', 'spanned'];

var randomIntervals = [ {value: 'hourly', title: _('on the hour')},
                        {value: 'daily', title: _('every day at midnight')},
                        {value: 'weekly', title: _('every Sunday at midnight')} ];

var BingImageURL = 'https://www.bing.com/HPImageArchive.aspx';
var BingParams = { format: 'js', idx: '0' , n: '8' , mbl: '1' , mkt: '' } ;

function validate_icon(settings, icon_image = null) {
    log('validate_icon()');
    let icon_name = settings.get_string('icon-name');
    if (icon_name == '' || icon_list.indexOf(icon_name) == -1) {
        settings.reset('icon-name');
        icon_name = settings.get_string('icon-name');
    }
    // if called from prefs
    if (icon_image) { 
        log('set icon to: ' + Me.dir.get_path() + '/icons/' + icon_name + '.svg');
        let pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(Me.dir.get_path() + '/icons/' + icon_name + '.svg', 32, 32);
        icon_image.set_from_pixbuf(pixbuf);
    }
}

function validate_resolution(settings) {
    let resolution = settings.get_string('resolution');
    if (resolution == '' || resolutions.indexOf(resolution) == -1) // if not a valid resolution
        settings.reset('resolution');
}

// FIXME: needs work
function validate_imagename(settings) {
    let filename = settings.get_string('selected-image');
    if (!inImageList(getImageList(settings), filename)) {
        log('invalid image selected');
        settings.set_string('selected-image', 'current');
    }
}

function get_current_bg(schema) {
    let gsettings = new Gio.Settings({ schema: schema });
    let cur = gsettings.get_string('picture-uri');
    return (cur);
}

function fetch_change_log(version, label, httpSession) {
    // create an http message
    let url = gitreleaseurl + "v" + version;
    let request = Soup.Message.new('GET', url);
    request.request_headers.append('Accept', 'application/json');
    log("Fetching " + url);
    // queue the http request
    try {
        if (Soup.MAJOR_VERSION >= 3) {
            httpSession.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                let data = ByteArray.toString(httpSession.send_and_read_finish(message).get_data());
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
        log("Error fetching change log: " + error);
        label.set_label(_("Error fetching change log: "+error));
    }
}

function set_blur_preset(settings, preset) {
    settings.set_int('lockscreen-blur-strength', preset.blur);
    settings.set_int('lockscreen-blur-brightness', preset.dim);
    log("Set blur preset to " + preset.blur + " brightness to " + preset.dim);
}

function is_x11() {
    return GLib.getenv('XDG_SESSION_TYPE') == 'x11'; // don't do wayland unsafe things if set
}

function enabled_unsafe() {
    //log("User override, enabling unsafe Wayland functionality");
    return true;
}

function gnome_major_version() {
    let [major] = Config.PACKAGE_VERSION.split('.');
    let shellVersion = Number.parseInt(major);

    return shellVersion;
}

function imageHasBasename(image_item, i, b) {
    //log("imageHasBasename : " + image_item.urlbase + " =? " + this);
    if (this && this.search(image_item.urlbase.replace('th?id=OHR.', '')))
        return true;
    return false;
}

function dateFromLongDate(longdate, add_seconds) {
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

function dateFromShortDate(shortdate) {
    if (typeof shortdate === 'number')
        shortdate = shortdate.toString();
    return GLib.DateTime.new(GLib.TimeZone.new_utc(),
                             parseInt(shortdate.substr(0, 4)), // year
                             parseInt(shortdate.substr(4, 2)), // month
                             parseInt(shortdate.substr(6, 2)), // day
                             0, 0, 0 );
}

function getImageList(settings, filter = null) {
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

function setImageList(settings, imageList) {
    settings.set_string('bing-json', JSON.stringify(imageList));
    if (settings.get_boolean('always-export-bing-json')) { // save copy of current JSON
        exportBingJSON(settings);
    }
}

function getImageTitle(image_data) {
    return image_data.copyright.replace(/\s*\(.*?\)\s*/g, '');
}

function getImageUrlBase(image_data) {
    return image_data.urlbase.replace('/th?id=OHR.', '');
}

function getMaxLongDate(settings) {
    let imageList = getImageList(settings);
    return Math.max.apply(Math, imageList.map(function(o) { return o.fullstartdate; }));
}

function getCurrentImageIndex (imageList) {
    if (!imageList)
        return -1;
    let maxLongDate = Math.max.apply(Math, imageList.map(function(o) { return o.fullstartdate; }));
    let index = imageList.map(p => parseInt(p.fullstartdate)).indexOf(maxLongDate);
    log('getCurrentImageIndex for ' + maxLongDate + ': ' + index);
    return index;
}

function setImageFavouriteStatus(settings, imageURL, newState) {
    log('set favourite status of '+imageURL+' to '+newState);
    let imageList = getImageList(settings);
    imageList.forEach(function(x, i) {
        //log('testing: '+imageURL+' includes '+x.urlbase);
        if (imageURL.includes(x.urlbase)) {
            log('setting index '+i+' to '+newState?'true':'false');
            imageList[i].favourite = newState;
        }
    });
    setImageList(settings, imageList); // save back to settings
}

function setImageHiddenStatus(settings, hide_image_list, hide_status) {
    // stub
    // get current image list
    let image_list = getImageList(settings);
    image_list.forEach( (x, i) => {
        hide_image_list.forEach(u => {
            if (u.includes(x.urlbase)) {
                // mark as hidden
                x.hidden = hide_status;
            }
        });
    });
    // export image list back to settings
    setImageList(settings, image_list);
}

function getCurrentImage(imageList) {
    if (!imageList || imageList.length == 0)
        return null;
    let index = getCurrentImageIndex(imageList);
    if (index == -1)
        return imageList[0]; // give something sensible
    return imageList[index];
}

function inImageList(imageList, urlbase) {
    let image = null;
    imageList.forEach(function(x, i) {
        if (urlbase.replace('/th?id=OHR.', '') == x.urlbase.replace('/th?id=OHR.', ''))
            image = x;
    });
    return image;
}

function inImageListByTitle(imageList, title) {
    let image = null;
    imageList.forEach(function(x, i) {
        log('inImageListbyTitle(): ' + title + ' == ' + getImageTitle(x));
        if (getImageTitle(x) == title)
            image = x;
    });
    return image;
}

function mergeImageLists(settings, imageList) {
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

function imageIndex(imageList, urlbase) {
    return imageList.map(p => p.urlbase.replace('/th?id=OHR.', '')).indexOf(urlbase.replace('/th?id=OHR.', ''));
}

function isFavourite(image) {
    return (image.favourite && image.favourite === true);
}

function getImageByIndex(imageList, index) {
    if (imageList.length == 0 || index < 0 || index > imageList.length - 1)
        return null;
    return imageList[index];
}

function getFetchableImageList(settings) {
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

function cleanupImageList(settings) {
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
            log('Cleaning up: '+filename);
        }
    });
    setImageList(settings, newList);
}

function populateImageListResolutions(settings) {
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

function getWallpaperDir(settings) {
    let homeDir =  GLib.get_home_dir(); 
    let BingWallpaperDir = settings.get_string('download-folder').replace('~', homeDir); 
    let userPicturesDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
    let userDesktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP); // seems to be a safer default
    if (BingWallpaperDir == '') {
        BingWallpaperDir = (userPicturesDir?userPicturesDir:userDesktopDir) + '/BingWallpaper/';
        log('Using default download folder: ' + BingWallpaperDir);
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

function setWallpaperDir(settings, uri) {
    let homeDir =  GLib.get_home_dir();
    let relUri = uri.replace(homeDir, '~');
    settings.set_string('download-folder', relUri);
}

function imageToFilename(settings, image, resolution = null) {
    return getWallpaperDir(settings) + image.startdate + '-' +
		image.urlbase.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + '_'
		+ (resolution ? resolution : getResolution(settings, image)) + '.jpg';
}

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

// Utility function
function dump(object, level = 0) {
    let output = '';
    for (let property in object) {
        output += ' - '.repeat(level)+property + ': ' + object[property]+'\n ';
		if ( typeof object[property] === 'object' )
			output += dump(object[property], level+1);
    }
	if (level == 0)
		log(output);
    return(output);
}

function friendly_time_diff(time, short = true) {
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

function seconds_until(until) {
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
    log('shuffle timer will be set to '+end.format_iso8601());
    return(Math.floor(end.difference(now)/1000000)); // difference in μs -> s
}

function getResolution(settings, image) {
    let resolution = settings.get_string('resolution');
    if (resolutions.indexOf(resolution) == -1 || (image ? image.wp == false : true) || // wp == false when background is animated
		settings.get_string('resolution') == 'auto' ) {
        // resolution invalid, animated background or autoselected
        resolution = 'UHD';
    }
    return resolution;
}

function openImageFolder(settings) {
    //const context = global?global.create_app_launch_context(0, -1):null;
    Gio.AppInfo.launch_default_for_uri('file://' + getWallpaperDir(settings), null);
}

function imageListSortByDate(imageList) {
    return imageList.sort(function(a, b) {
        var x = parseInt(a.fullstartdate); var y = parseInt(b.fullstartdate);
        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}

function shortenName(string, limit) {
    if (string.length > limit) {
        string = string.substr(0, limit - 4) + '...';
    }
    return string;
}

function moveImagesToNewFolder(settings, oldPath, newPath) {
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
            log('file: ' + slash(oldPath) + filename + ' -> ' + slash(newPath) + filename);
            let cur = Gio.file_new_for_path(slash(oldPath) + filename);
            let dest = Gio.file_new_for_path(slash(newPath) + filename);
            cur.move(dest, Gio.FileCopyFlags.OVERWRITE, null, function () { log ('...moved'); });
        }
    }
    // correct filenames for GNOME backgrounds
    if (settings.get_boolean('set-background'))
        moveBackground(oldPath, newPath, DESKTOP_SCHEMA);
}

function dirname(path) {
    return path.match(/.*\//);
}

function slash(path) {
    if (!path.endsWith('/'))
        return path += '/';
    return path;
}

function moveBackground(oldPath, newPath, schema) {
    let gsettings = new Gio.Settings({schema: schema});
    let uri = gsettings.get_string('picture-uri');
    gsettings.set_string('picture-uri', uri.replace(oldPath, newPath));
    try {
        let dark_uri = gsettings.get_string('picture-uri-dark');
		gsettings.set_string('picture-uri-dark', dark_uri.replace(oldPath, newPath));
	}
	catch (e) {
		log('no dark background gsettings key found ('+e+')');
	}
    Gio.Settings.sync();
    gsettings.apply();
}

function log(msg) {
    if (debug)
        print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
}

function deleteImage(to_delete) {
    var file = Gio.file_new_for_path(to_delete);
    if (file.query_exists(null)) {
        try {
            file.delete(null);
            log("deleted file: " + to_delete);
        }
        catch (error) {
            log("an error occured deleting " + to_delete + " : " + error);
        }
    }
}

// add image to persistant list so we can delete it later (in chronological order), delete the oldest image (if user wants this)
function purgeImages(settings) {
    let deletepictures = settings.get_boolean('delete-previous');
    if (deletepictures === false)
        return;
    let imagelist = imageListSortByDate(getImageList(settings));
    let maxpictures = settings.get_int('previous-days');
    let origlength = imagelist.length;
    while (imagelist.length > maxpictures) {
        var to_delete = imagelist.shift(); // get the first (oldest item from the list)
        if (deletepictures && to_delete != '') {
            let imageFilename = imageToFilename(settings, to_delete);
            log('deleting '+imageFilename);
            deleteImage(imageFilename);
        }
    }
    log('cleaned up image list, count was '+origlength+' now '+imagelist.length);
    cleanupImageList(settings);
    validate_imagename(settings); // if we deleted our current image, we want to reset it to something valid
}

function openInSystemViewer(filename, is_file = true) {
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

function exportBingJSON(settings) {
    let json = settings.get_string('bing-json');
    let filepath = getWallpaperDir(settings) + 'bing.json';
    let file = Gio.file_new_for_path(filepath);
    let [success, error] = file.replace_contents(json, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    if (!success) {
        log('error saving bing-json from '+filepath+': '+error);
    }
}

function importBingJSON(settings) {
    let filepath = getWallpaperDir(settings) + 'bing.json';
    let file = Gio.file_new_for_path(filepath);
    if (file.query_exists(null)) {
        let [success, contents, etag_out] = file.load_contents(null);
        if (!success) {
            log('error loading bing-json '+filepath+' - '+etag_out);
        }
        else {
            log('JSON import success');
            let parsed = JSON.parse(ByteArray.toString(contents)); // FIXME: triggers GJS warning without the conversion, need to investigate
            // need to implement some checks for validity here
            mergeImageLists(settings, parsed);
            cleanupImageList(settings); // remove the older missing images
        }
    }
    else {
        log('JSON import file not found');
    }
}

function getFileDimensions(filepath) {
    let format, width, height;
    try {
        [format, width, height] = GdkPixbuf.Pixbuf.get_file_info(filepath);
        return [width, height];
    }
    catch (e) {
        log('unable to getFileDimensions('+filepath+') '+e);
        return [null, null];
    }

}

function toFilename(wallpaperDir, startdate, imageURL, resolution) {
    return wallpaperDir + startdate + '-' + imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + '_' + resolution + '.jpg';
}

function initSoup() {
    try {
        let httpSession = new Soup.Session();
        httpSession.user_agent = 'User-Agent: Mozilla/5.0 (X11; GNOME Shell/' + imports.misc.config.PACKAGE_VERSION + '; Linux x86_64; +https://github.com/neffo/bing-wallpaper-gnome-extension ) BingWallpaper GNOME Extension/' + Me.metadata.version;
        return httpSession;
    }
    catch (e) {
        log('Unable to create soup session: '+e);
        return null;
    }

}