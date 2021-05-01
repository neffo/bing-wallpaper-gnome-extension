// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2021 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

const St = imports.gi.St;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Soup = imports.gi.Soup;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Gtk = imports.gi.Gtk;
const Util = imports.misc.util;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const Clipboard = St.Clipboard.get_default();
const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;
const UnlockDialog = imports.ui.unlockDialog.UnlockDialog;
const GdkPixbuf = imports.gi.GdkPixbuf;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Blur = Me.imports.blur;

const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;

const BingImageURL = Utils.BingImageURL;
const BingURL = "https://www.bing.com";
const IndicatorName = "BingWallpaperIndicator";
const TIMEOUT_SECONDS = 24 * 3600; // FIXME: this should use the end data from the json data
const TIMEOUT_SECONDS_ON_HTTP_ERROR = 1 * 3600; // retry in one hour if there is a http error

let validresolutions = [ '800x600' , '1024x768', '1280x720', '1280x768', '1366x768', '1920x1080', '1920x1200', 'UHD'];

let autores; // automatically selected resolution

let bingWallpaperIndicator=null;
let blur=null;
let init_called=false;
let blur_brightness=0.55;
let blur_strength=30;

// remove this when dropping support for < 3.33, see https://github.com/OttoAllmendinger/
const getActorCompat = (obj) =>
  Convenience.currentVersionGreaterEqual("3.33") ? obj : obj.actor;

function log(msg) {
    if (bingWallpaperIndicator==null || bingWallpaperIndicator._settings.get_boolean('debug-logging'))
        print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
}

// Utility function
function dump(object) {
    let output = '';
    for (let property in object) {
        output += property + ': ' + object[property]+'; ';
    }
    log(output);
}

function notifyError(msg) {
    Main.notifyError("BingWallpaper extension error", msg);
}

function doSetBackground(uri, schema) {
    let gsettings = new Gio.Settings({schema: schema});
    let prev = gsettings.get_string('picture-uri');
    uri = 'file://'+ uri;
    gsettings.set_string('picture-uri', uri);
    gsettings.set_string('picture-options', 'zoom');
    Gio.Settings.sync();
    gsettings.apply();
    return (prev != uri); // return true if background uri has changed
}

function friendly_time_diff(time, short = true) {
    // short we want to keep ~4-5 characters
    let timezone = GLib.TimeZone.new_local();
    let now = GLib.DateTime.new_now(timezone).to_unix();
    let seconds = time.to_unix() - now;

    if (seconds <= 0) {
        return "now";
    }
    else if (seconds < 60) {
        return "< 1 "+(short?"m":_("minutes"));
    }
    else if (seconds < 3600) {
        return Math.round(seconds/60)+" "+(short?"m":_("minutes"));
    }
    else if (seconds > 86400) {
        return Math.round(seconds/86400)+" "+(short?"d":_("days"));
    }
    else {
        return Math.round(seconds/3600)+" "+(short?"h":_("hours"));
    }
}

let httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());

const BingWallpaperIndicator = new Lang.Class({
    Name: IndicatorName,
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, IndicatorName);

        this.title = "";
        this.explanation = "";
        this.filename = "";
        this.copyright = "";
        this.version = "0.1";
        this._updatePending = false;
        this._timeout = null;
        this.longstartdate = null;
        this.imageURL= ""; // link to image itself
        this.imageinfolink = ""; // link to Bing photo info page
        this.refreshdue = 0;
        this.refreshduetext = "";
        this.thumbnail = null;
        this.selected_image = "current";
        blur = new Blur.Blur();
        blur.blur_strength = 30;
        blur.blur_brightness = 0.55;

        // take a variety of actions when the gsettings values are modified by prefs
        this._settings = Utils.getSettings();
        this._settings.connect('changed::hide', Lang.bind(this, function() {
            getActorCompat(this).visible = !this._settings.get_boolean('hide');
        }));
        this._setIcon(this._settings.get_string('icon-name'));
        this._settings.connect('changed::icon-name', Lang.bind(this, function() {
            this._setIcon(this._settings.get_string('icon-name'));
        }));
        this._settings.connect('changed::market', Lang.bind(this, function() {
            this._refresh();
        }));
        this._settings.connect('changed::set-background', Lang.bind(this, function() {
            this._setBackground();
        }));
        this._settings.connect('changed::set-lockscreen', Lang.bind(this, function() {
            this._setBackground();
        }));
        this._settings.connect('changed::override-lockscreen-blur', Lang.bind(this, function () {
            blur._switch(this._settings.get_boolean('override-lockscreen-blur'));
            blur.set_blur_strength(this._settings.get_int('lockscreen-blur-strength'));
            blur.set_blur_brightness(this._settings.get_int('lockscreen-blur-brightness'));
        }));
        this._settings.connect('changed::lockscreen-blur-strength', Lang.bind(this, function () {
            blur.set_blur_strength(this._settings.get_int('lockscreen-blur-strength'));
        }));
        this._settings.connect('changed::lockscreen-blur-brightness', Lang.bind(this, function () {
            blur.set_blur_brightness(this._settings.get_int('lockscreen-blur-brightness'));
        }));
        blur._switch(this._settings.get_boolean('override-lockscreen-blur'));
        blur.set_blur_strength(this._settings.get_int('lockscreen-blur-strength'));
        blur.set_blur_brightness(this._settings.get_int('lockscreen-blur-brightness'));
        this._settings.connect('changed::selected-image', Lang.bind(this, function () {
            blur.set_blur_brightness(this._settings.get_int('lockscreen-blur-brightness'));
        }));

        this._settings.connect('changed::selected-image', Lang.bind(this, function () {
            Utils.validate_imagename(this._settings);
            this.selected_image = this._settings.get_string('selected-image');
            log('selected image changed to :'+this.selected_image);
            this._selectImage();
        }));

        getActorCompat(this).visible = !this._settings.get_boolean('hide');

        this.refreshDueItem = new PopupMenu.PopupMenuItem(_("<No refresh scheduled>"));
        //this.showItem = new PopupMenu.PopupMenuItem(_("Show description"));
        this.titleItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh...")); //FIXME: clean this up
        this.titleItem.label.get_clutter_text().set_line_wrap(true);
        this.titleItem.label.set_style("max-width: 350px;");
        this.explainItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh..."));
        this.explainItem.label.get_clutter_text().set_line_wrap(true);
        this.explainItem.label.set_style("max-width: 350px;");
        this.copyrightItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh..."));
        this.copyrightItem.label.get_clutter_text().set_line_wrap(true);
        this.copyrightItem.label.set_style("max-width: 350px;");
        this.separator = new PopupMenu.PopupSeparatorMenuItem();
        this.clipboardImageItem = new PopupMenu.PopupMenuItem(_("Copy image to clipboard"));
        this.clipboardURLItem = new PopupMenu.PopupMenuItem(_("Copy image URL to clipboard"));
        this.dwallpaperItem = new PopupMenu.PopupMenuItem(_("Set background image"));
        this.swallpaperItem = new PopupMenu.PopupMenuItem(_("Set lock screen image"));
        this.refreshItem = new PopupMenu.PopupMenuItem(_("Refresh Now"));
        this.settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
        if (Utils.is_x11()) { // causes crashes when XWayland is not available, ref github #82
            this.thumbnailItem = new PopupMenu.PopupBaseMenuItem(); // new Gtk.AspectFrame('Preview',0.5, 0.5, 1.77, false);
        }
        else {
            this.thumbnailItem = new PopupMenu.PopupMenuItem(_("Thumbnail disabled on Wayland"));
            log('X11 not detected, disabling some unsafe features');
        }
        this.menu.addMenuItem(this.refreshItem);
        this.menu.addMenuItem(this.refreshDueItem);
        this.menu.addMenuItem(this.titleItem);
        this.menu.addMenuItem(this.thumbnailItem);
        this.menu.addMenuItem(this.explainItem);
        this.menu.addMenuItem(this.copyrightItem);
        //this.menu.addMenuItem(this.showItem);
        this.menu.addMenuItem(this.separator);
        if (Utils.is_x11()) { // these do not work on Wayland atm
            this.menu.addMenuItem(this.clipboardImageItem);
            this.menu.addMenuItem(this.clipboardURLItem);
            this.clipboardURLItem.connect('activate', Lang.bind(this, this._copyURLToClipboard));
            this.clipboardImageItem.connect('activate', Lang.bind(this, this._copyImageToClipboard));
        }
        
        this.menu.addMenuItem(this.dwallpaperItem);
        if (!Convenience.currentVersionGreaterEqual("3.36")) { // lockscreen and desktop wallpaper are the same in GNOME 3.36+
            this.menu.addMenuItem(this.swallpaperItem);
            this.swallpaperItem.connect('activate', Lang.bind(this, this._setBackgroundScreensaver));
        }
            
        this.menu.addMenuItem(this.settingsItem);
        this.explainItem.setSensitive(false);
        this.copyrightItem.setSensitive(false);
        this.refreshDueItem.setSensitive(false);
        this.thumbnailItem.setSensitive(false);
        this.titleItem.connect('activate', Lang.bind(this, function() {
            if (this.imageinfolink)
              Util.spawn(["xdg-open", this.imageinfolink]);
        }));
        
        this.dwallpaperItem.connect('activate', Lang.bind(this, this._setBackgroundDesktop));
        this.refreshItem.connect('activate', Lang.bind(this, this._refresh));
        this.settingsItem.connect('activate', function() {
            if (ExtensionUtils.openPrefs)
                ExtensionUtils.openPrefs();
            else 
                Util.spawn(["gnome-extensions", "prefs", Me.metadata.uuid]); // fall back for older gnome versions          
        });

        getActorCompat(this).connect('button-press-event', Lang.bind(this, function () {
            // Grey out menu items if an update is pending
            this.refreshItem.setSensitive(!this._updatePending);
            if (Utils.is_x11()) {
                this.clipboardImageItem.setSensitive(!this._updatePending && this.imageURL != "");
                this.clipboardURLItem.setSensitive(!this._updatePending && this.imageURL != "");
	    }
            this.thumbnailItem.setSensitive(!this._updatePending && this.imageURL != "");
            //this.showItem.setSensitive(!this._updatePending && this.title != "" && this.explanation != "");
            this.dwallpaperItem.setSensitive(!this._updatePending && this.filename != "");
            this.swallpaperItem.setSensitive(!this._updatePending && this.filename != "");
            this.titleItem.setSensitive(!this._updatePending && this.imageinfolink != "");
            this.refreshduetext = _("Next refresh") + ": " + this.refreshdue.format("%X") + " (" + friendly_time_diff(this.refreshdue) + ")";
            this.refreshDueItem.label.set_text(this.refreshduetext); //
        }));
        this._restartTimeout(60); // wait 60 seconds before performing refresh
    },

    // set indicator icon (tray icon)
    _setIcon: function(icon_name) {
        //log('Icon set to : '+icon_name)
        Utils.validate_icon(this._settings);
        let gicon = Gio.icon_new_for_string(Me.dir.get_child('icons').get_path() + "/" + icon_name + ".svg");
        this.icon = new St.Icon({gicon: gicon, style_class: 'system-status-icon'});
        if (!this.icon.get_parent() && 0) {
            log('New icon set to : '+icon_name);
            getActorCompat(this).add_child(this.icon);
        }
        else {
            log('Replace icon set to : '+icon_name);
            getActorCompat(this).remove_all_children();
            getActorCompat(this).add_child(this.icon);
        }
    },

    // set backgrounds as requested and set preview image in menu
    _setBackground: function() {
        if (this.filename == "")
            return;
        if (Utils.is_x11()) { // wayland - only if we are sure it's safe to do so, we can't know if xwayland is running
            this.thumbnail = new Thumbnail(this.filename);
            this._setImage();
        }

        if (this._settings.get_boolean('set-background'))
            this._setBackgroundDesktop();

        if (this._settings.get_boolean('set-lock-screen'))
            this._setBackgroundScreensaver();
    },

    _setBackgroundDesktop: function() {
        doSetBackground(this.filename, 'org.gnome.desktop.background');
    },
    
    _setBackgroundScreensaver: function() {
        doSetBackground(this.filename, 'org.gnome.desktop.screensaver');
    },

    _copyURLToClipboard: function() {
        Clipboard.set_text(CLIPBOARD_TYPE, this.imageURL);
    },

    _copyImageToClipboard: function() {
        Clipboard.setImage(this.thumbnailImage.gtkImage);
    },

    // sets a timer for next refresh of Bing metadata
    _restartTimeout: function(seconds = null) {
        if (this._timeout)
            Mainloop.source_remove(this._timeout);
        if (seconds == null)
            seconds = TIMEOUT_SECONDS;
        this._timeout = Mainloop.timeout_add_seconds(seconds, Lang.bind(this, this._refresh));
        let timezone = GLib.TimeZone.new_local();
        let localTime = GLib.DateTime.new_now(timezone).add_seconds(seconds);
        this.refreshdue = localTime;
        log('next check in '+seconds+' seconds @ local time '+localTime);
    },

    // set a timer on when the current image is going to expire
    _restartTimeoutFromLongDate: function (longdate) {
         // all bing times are in UTC (+0)
        let refreshDue = Utils.dateFromLongDate(longdate, 86400);
        let timezone = GLib.TimeZone.new_local();
        let now = GLib.DateTime.new_now(timezone);
        let difference = refreshDue.difference(now)/1000000;

        log("Next refresh due @ "+refreshDue.format('%F %R %z')+" = "+difference+" seconds from now ("+now.format('%F %R %z')+")");

        if (difference < 60 || difference > 86400) // something wierd happened
            difference = 3600;

        difference=difference+300; // 5 minute fudge offset in case of inaccurate local clock
        this._restartTimeout(difference);
    },

    // convert shortdate format into human friendly format
    _localeDate: function (shortdate) {
      let date = Utils.dateFromShortDate(shortdate);
      return date.format('%Y-%m-%d'); // ISO 8601 - https://xkcd.com/1179/
    },

    // set menu text in lieu of a notification/popup
    _setMenuText: function() {
        this.titleItem.label.set_text(this.title);
        this.explainItem.label.set_text(this.explanation);
        this.copyrightItem.label.set_text(this.copyright);
    },

    // set menu thumbnail
    _setImage: function () {
        let pixbuf = this.thumbnail.pixbuf;
        if (pixbuf == null)
            return;
        const { width, height } = pixbuf;
        if (height == 0) {
            return;
        }
        const image = new Clutter.Image();
        const success = image.set_data(
            pixbuf.get_pixels(),
            pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
            width,
            height,
            pixbuf.get_rowstride()
        );
        if (!success) {
            throw Error("error creating Clutter.Image()");
        }

        getActorCompat(this.thumbnailItem).hexpand = false;
        getActorCompat(this.thumbnailItem).vexpand = false;
        getActorCompat(this.thumbnailItem).content = image;
    
        getActorCompat(this.thumbnailItem).set_size(480, 270);    
        this.thumbnailItem.setSensitive(true);
      },

    // download Bing metadat
    _refresh: function() {
        if (this._updatePending)
            return;
        this._updatePending = true;

        this._restartTimeout();

        let market = this._settings.get_string('market');
        log("market: " + market);

        // create an http message
        let request = Soup.Message.new('GET', BingImageURL+market); // + market
        log("fetching: " + BingImageURL+market);

        // queue the http request
        httpSession.queue_message(request, Lang.bind(this, function(httpSession, message) {
            if (message.status_code == 200) {
                let data = message.response_body.data;
                log("Recieved "+data.length+" bytes");
                this._parseData(data);
                this._selectImage();
            } else if (message.status_code == 403) {
                log("Access denied: "+message.status_code);
                this._updatePending = false;
                this._restartTimeout(TIMEOUT_SECONDS_ON_HTTP_ERROR);
            } else {
                log("Network error occured: "+message.status_code);
                this._updatePending = false;
                this._restartTimeout(TIMEOUT_SECONDS_ON_HTTP_ERROR);
            }
        }));
    },

    // process Bing metadata
    _parseData: function(data) {
        let parsed = JSON.parse(data);
        let datamarket = parsed.market.mkt;
        let prefmarket = this._settings.get_string('market');

        //Utils.setImageList(this._settings, parsed.images);
        // FIXME: we need to handle this better, including storing longer history & removing duplicates and deleted files
        Utils.mergeImageLists(this._settings, parsed.images);

        // FIXME: this is only here for testing, delete before release
        //oldJson = '{"market":{"mkt":"en-AU"},"images":[{"startdate":"20190515","fullstartdate":"201905151400","enddate":"20190516","url":"/th?id=OHR.AbuSimbel_EN-AU0072035482_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.AbuSimbel_EN-AU0072035482","copyright":"Abu Simbel temples on the west shore of Lake Nasser, Egypt (© George Steinmetz/Getty Images)","copyrightlink":"http://www.bing.com/search?q=abu+simbel+temples&form=hpcapt&filters=HpDate:%2220190515_1400%22","title":"Egypt’s mysteries still delight","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20190515_AbuSimbel%22&FORM=HPQUIZ","wp":true,"hsh":"71857c9b9e15abfd8a8fe7b8135c59ff","drk":1,"top":1,"bot":1,"hs":[]}],"tooltips":{"loading":"Loading...","previous":"Previous image","next":"Next image","walle":"This image is not available to download as wallpaper.","walls":"Download this image. Use of this image is restricted to wallpaper only."}}';
        //Utils.mergeImageLists(this._settings, JSON.parse(oldJson).images);
        // end bit to delete
        
        Utils.cleanupImageList(this._settings);

        log('JSON returned (raw):\n' + data);
        this._restartTimeoutFromLongDate(parsed.images[0].fullstartdate); // timing is set by Bing, and possibly varies by market
        this._updatePending = false;
    },

    _selectImage: function() {
        imageList = JSON.parse(this._settings.get_string('bing-json'));
        //let selected_image = this._settings.get_string('selected-image');
        //let image = imageList.findIndex(Utils.imageHasBasename, null, null, this.selected_image);
        let image = null;
        if (this.selected_image == 'random') {
            // do random selection here
            image = imageList[Utils.getRandomInt(imageList.length)];
        } else if (this.selected_image == 'current') {
            image = imageList[0];
        } else {    
            //let indx = imageList.findIndex(x => this.selected_image.search(x.urlbase.replace('/th?id=OHR.', ''))>0);
            image = Utils.inImageList(imageList, this.selected_image);
            //image = imageList[indx];
            log('_selectImage: '+this.selected_image+' = '+image?image.urlbase:"not found");
        }
        if (!image)
            image = imageList[0];
        // special values, 'current' is most recent (default mode), 'random' picks one at random, anything else should be filename
        //image = imageList[0]; // this should be selected based on value of 'selected-image'

        if (image.url != '') {
            this.title = image.copyright.replace(/\s*\(.*?\)\s*/g, "");
            this.explanation = _("Bing Wallpaper of the Day for")+' '+this._localeDate(image.startdate);
            this.copyright = image.copyright.match(/\(([^)]+)\)/)[1].replace('\*\*','');

            this.longstartdate = image.fullstartdate;
            this.imageinfolink = image.copyrightlink.replace(/^http:\/\//i, 'https://');
            let resolution = this._settings.get_string('resolution');

            if (resolution == "auto") {
                log("auto resolution selected ("+autores+")");
                resolution = autores;
            }

            if (Utils.resolutions.indexOf(resolution) == -1 || image.wp == false ||
                (this._settings.get_string('resolution') == "auto" && autores == "1920x1200") ) {
                // resolution invalid, animated background, or override auto selected 1920x1200 to avoid bing logo unless user wants it
                resolution = "UHD";
            }

            this.imageURL = BingURL+image.urlbase+"_"+resolution+".jpg"; // generate image url for user's resolution

            let BingWallpaperDir = Utils.getWallpaperDir(this._settings);

            this.filename = BingWallpaperDir+image.startdate+'-'+this.imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '');
            let file = Gio.file_new_for_path(this.filename);
            let file_exists = file.query_exists(null);
            let file_info = file_exists ? file.query_info ('*',Gio.FileQueryInfoFlags.NONE,null): 0;

            if (!file_exists || file_info.get_size () == 0) { // file doesn't exist or is empty (probably due to a network error)
                let dir = Gio.file_new_for_path(BingWallpaperDir);
                if (!dir.query_exists(null)) {
                    dir.make_directory_with_parents(null);
                }
                this._download_image(this.imageURL, file);
            } else {
                log("Image already downloaded");
                let changed = this._setBackground();
                this._updatePending = false;
            }
            
        } else {
            this.title = _("No wallpaper available");
            this.explanation = _("No picture for today 😞.");
            this.filename = "";
            this._updatePending = false;
        }
        this._setMenuText();
    },

    // download and process new image
    _download_image: function(url, file) {
        log("Downloading " + url + " to " + file.get_uri());

        // open the Gfile
        let fstream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

        // create an http message
        let request = Soup.Message.new('GET', url);

        // got_headers event
        request.connect('got_headers', Lang.bind(this, function(message){
            log("got_headers, status: "+message.status_code);
        }));

        // got_chunk event
        request.connect('got_chunk', Lang.bind(this, function(message, chunk){
            //log("got_chuck, status: "+message.status_code);
            if (message.status_code == 200) { // only save the data we want, not content of 301 redirect page
                fstream.write(chunk.get_data(), null);
            }
            else {
                log("got_chuck, status: "+message.status_code);
            }
        }));

        // queue the http request
        httpSession.queue_message(request, Lang.bind(this, function(httpSession, message) {
            // request completed
            fstream.close(null);
            this._updatePending = false;
            if (message.status_code == 200) {
                log('Download successful');
                this._setBackground();
                this._add_to_previous_queue(this.filename);
            } else {
                log("Couldn't fetch image from " + url);
                file.delete(null);
            }
        }));
    },

    // add image to persistant list so we can delete it later (in chronological order), delete the oldest image (if user wants this)
    _add_to_previous_queue: function (filename) {
        let rawimagelist = this._settings.get_string('previous');
        let imagelist = rawimagelist.split(',');
        let maxpictures = this._settings.get_int('previous-days');
        let deletepictures = this._settings.get_boolean('delete-previous');

        log("Raw: "+ rawimagelist+" count: "+imagelist.length);
        log("Settings: delete:"+(deletepictures?"yes":"no")+" max: "+maxpictures);

        imagelist.push(filename); // add current to end of list

        while(imagelist.length > maxpictures+1) {
            var to_delete = imagelist.shift(); // get the first (oldest item from the list)
            log("image: "+to_delete);
            if (deletepictures && to_delete != '') {
                var file = Gio.file_new_for_path(to_delete);
                if (file.query_exists(null)) {
                    file.delete(null);
                    log("deleted file: "+ to_delete);
                }
            }
        }

        // put it back together and send back to settings
        rawimagelist = imagelist.join();
        this._settings.set_string('previous', rawimagelist);
        log("wrote back this: "+rawimagelist);
    },

    // open image in default image view
    _open_in_system_viewer: function launchOpen() {
        const context = global.create_app_launch_context(0, -1);
        Gio.AppInfo.launch_default_for_uri(this.filename.get_uri(), context);
    },

    stop: function () {
        if (this._timeout)
            Mainloop.source_remove(this._timeout);
        this._timeout = undefined;
        this.menu.removeAll();
    }
});

function init(extensionMeta) {
    if (init_called === false) {
        Convenience.initTranslations("BingWallpaper");
        init_called = true;
    }
    else {
        log("WARNING: init() called more than once, ignoring");
   }
}

function enable() {
    bingWallpaperIndicator = new BingWallpaperIndicator();
    Main.panel.addToStatusArea(IndicatorName, bingWallpaperIndicator);
    autores = "UHD"; // remove monitor size checks
}

function disable() {
    if (this._timeout)
            Mainloop.source_remove(this._timeout);
    bingWallpaperIndicator.stop();
    bingWallpaperIndicator.destroy();
    bingWallpaperIndicator = null;
}

function toFilename(wallpaperDir, startdate, imageURL) {
    return wallpaperDir+startdate+'-'+imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '');
}

class Thumbnail {
    constructor(filePath) {
      if (!filePath) {
        throw new Error(`need argument ${filePath}`);
      }
      try {
        this.pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(filePath, 480, 270); 
        this.srcFile = Gio.File.new_for_path(filePath);
      }
      catch(err) {
        log('Unable to create thumbnail for corrupt or incomplete file: '+filePath+ ' err: '+err);
      }
    }
  }
