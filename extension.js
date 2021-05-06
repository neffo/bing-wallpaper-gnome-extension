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
const UnlockDialog = imports.ui.unlockDialog.UnlockDialog;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gdk = imports.gi.Gdk;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Blur = Me.imports.blur;
const Thumbnail = Me.imports.thumbnail;
const BWClipboard = Me.imports.BWClipboard;
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
let blur_brightness=0.55;
let blur_strength=30;

// remove this when dropping support for < 3.33, see https://github.com/OttoAllmendinger/
const getActorCompat = (obj) =>
  Convenience.currentVersionGreaterEqual("3.33") ? obj : obj.actor;

function log(msg) {
    if (bingWallpaperIndicator==null || bingWallpaperIndicator._settings.get_boolean('debug-logging'))
        print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
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
        this.clipboard = new BWClipboard.BWClipboard();
        blur = new Blur.Blur();
        blur.blur_strength = 30;
        blur.blur_brightness = 0.55;

        // take a variety of actions when the gsettings values are modified by prefs
        this._settings = Utils.getSettings();
        this._setConnections();

        getActorCompat(this).visible = !this._settings.get_boolean('hide');

        // enable unsafe features on Wayland if the user overrides it
        if (this._settings.get_boolean('override-unsafe-wayland')) {
            Utils.is_x11 = Utils.enabled_unsafe;
        }

        this.refreshDueItem = new PopupMenu.PopupMenuItem(_("<No refresh scheduled>"));
        //this.showItem = new PopupMenu.PopupMenuItem(_("Show description"));
        this.titleItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh...")); //FIXME: clean this up
        this._wrapLabelItem(this.titleItem);
        this.explainItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh..."));
        this._wrapLabelItem(this.explainItem);
        this.copyrightItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh..."));
        this._wrapLabelItem(this.copyrightItem);
        this.separator = new PopupMenu.PopupSeparatorMenuItem();
        this.clipboardImageItem = new PopupMenu.PopupMenuItem(_("Copy image to clipboard"));
        this.clipboardURLItem = new PopupMenu.PopupMenuItem(_("Copy image URL to clipboard"));
        this.folderItem = new PopupMenu.PopupMenuItem(_("Open image folder"));
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
        if (Utils.is_x11() && this.clipboard.clipboard) { // these may not work on Wayland atm, check to see if it's working
            // currently non functional
            /*this.menu.addMenuItem(this.clipboardImageItem);
            this.clipboardImageItem.connect('activate', Lang.bind(this, this._copyImageToClipboard));*/
            this.menu.addMenuItem(this.clipboardURLItem);
            this.clipboardURLItem.connect('activate', Lang.bind(this, this._copyURLToClipboard));
        }

        this.menu.addMenuItem(this.folderItem);
        
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
        this.thumbnailItem.connect('activate', Lang.bind(this, function() {
            this._openInSystemViewer();
        }));
        this.titleItem.connect('activate', Lang.bind(this, function() {
            if (this.imageinfolink)
              Util.spawn(["xdg-open", this.imageinfolink]);
        }));
        this.folderItem.connect('activate', Lang.bind(this, function() {
            Utils.openImageFolder(this._settings);
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
            this.refreshduetext = _("Next refresh") + ": " + this.refreshdue.format("%X") + " (" + Utils.friendly_time_diff(this.refreshdue) + ")";
            this.refreshDueItem.label.set_text(this.refreshduetext); //
        }));
        this._restartTimeout(60); // wait 60 seconds before performing refresh
    },

    // listen for configuration changes
    _setConnections: function(){
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
        this.selected_image = this._settings.get_string('selected-image');
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
            this.thumbnail = new Thumbnail.Thumbnail(this.filename);
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
        this.clipboard.setText(this.imageURL);
    },

    _copyImageToClipboard: function() {
        this.clipboard.setImage(this.filename);
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

    _wrapLabelItem: function (menuItem) {
        menuItem.label.get_clutter_text().set_line_wrap(true);
        menuItem.label.set_style("max-width: 350px;");
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
        /*oldJsonImages = '[';
        oldJsonImages += '{"startdate":"20190515","fullstartdate":"201905151400","enddate":"20190516","url":"/th?id=OHR.AbuSimbel_EN-AU0072035482_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.AbuSimbel_EN-AU0072035482","copyright":"Abu Simbel temples on the west shore of Lake Nasser, Egypt (© George Steinmetz/Getty Images)","copyrightlink":"http://www.bing.com/search?q=abu+simbel+temples&form=hpcapt&filters=HpDate:%2220190515_1400%22","title":"Egypt’s mysteries still delight","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20190515_AbuSimbel%22&FORM=HPQUIZ","wp":true,"hsh":"71857c9b9e15abfd8a8fe7b8135c59ff","drk":1,"top":1,"bot":1,"hs":[]},';
        oldJsonImages += '{"startdate":"20210323","fullstartdate":"202103230700","enddate":"20210324","url":"/th?id=OHR.LoftedMadagascar_ROW4625924322_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.LoftedMadagascar_ROW4625924322","copyright":"Satellite image of the Mania River in Madagascar (© NASA Earth Observatory image by Joshua Stevens, using Landsat data from the US Geological Survey)","copyrightlink":"javascript:void(0)","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210323_LoftedMadagascar%22&FORM=HPQUIZ","wp":true,"hsh":"18c285623d7f2471d3a1d0722e0e3165","drk":1,"top":1,"bot":1,"hs":[]},';
        oldJsonImages += '{"startdate":"20210421","fullstartdate":"202104210700","enddate":"20210422","url":"/th?id=OHR.SaoJorgeMadeira_ROW4612072821_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.SaoJorgeMadeira_ROW4612072821","copyright":"Madeira, Portugal (© Hemis/Alamy)","copyrightlink":"https://www.bing.com/search?q=madeira+island&form=hpcapt&filters=HpDate%3a%2220210421_0700%22","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210421_SaoJorgeMadeira%22&FORM=HPQUIZ","wp":true,"hsh":"b47a9323cae2e6bfb8e6f1d4604c2caa","drk":1,"top":1,"bot":1,"hs":[]},{"startdate":"20210420","fullstartdate":"202104200700","enddate":"20210421","url":"/th?id=OHR.Ceking_ROW4482501669_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.Ceking_ROW4482501669","copyright":"Tegalalang Rice Terraces, Ubud, Bali, Indonesia (© Michele Falzone/Alamy)","copyrightlink":"https://www.bing.com/search?q=tegalalang+rice+terrace+bali&form=hpcapt&filters=HpDate%3a%2220210420_0700%22","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210420_Ceking%22&FORM=HPQUIZ","wp":true,"hsh":"045c1ecce767c48d796a4008aa32a626","drk":1,"top":1,"bot":1,"hs":[]},{"startdate":"20210419","fullstartdate":"202104190700","enddate":"20210420","url":"/th?id=OHR.Mobula_ROW4335910337_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.Mobula_ROW4335910337","copyright":"Munk\'s pygmy devil rays, Gulf of California, Mexico (© Mark Carwardine/Minden Pictures)","copyrightlink":"https://www.bing.com/search?q=Mobula+munkiana&form=hpcapt&filters=HpDate%3a%2220210419_0700%22","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210419_Mobula%22&FORM=HPQUIZ","wp":true,"hsh":"eb45744e7d0a1196495e4fc5873f9efd","drk":1,"top":1,"bot":1,"hs":[]},{"startdate":"20210418","fullstartdate":"202104180700","enddate":"20210419","url":"/th?id=OHR.MontalbanoElicona_ROW4195477684_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.MontalbanoElicona_ROW4195477684","copyright":"Montalbano Elicona, Messina, Sicily, Italy (© Antonino Bartuccio/SOPA Collection/Offset by Shutterstock)","copyrightlink":"https://www.bing.com/search?q=Montalbano+Elicona+Sicily&form=hpcapt&filters=HpDate%3a%2220210418_0700%22","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210418_MontalbanoElicona%22&FORM=HPQUIZ","wp":true,"hsh":"f8c3adca75b6a67cd968b9119f912cac","drk":1,"top":1,"bot":1,"hs":[]},{"startdate":"20210417","fullstartdate":"202104170700","enddate":"20210418","url":"/th?id=OHR.NewRiverGorge_ROW4012498745_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.NewRiverGorge_ROW4012498745","copyright":"New River Gorge Bridge, New River Gorge National Park and Preserve, West Virginia, USA (© Entropy Workshop/iStock/Getty Images Plus)","copyrightlink":"https://www.bing.com/search?q=New+River+Gorge+National+Park&form=hpcapt&filters=HpDate%3a%2220210417_0700%22","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210417_NewRiverGorge%22&FORM=HPQUIZ","wp":true,"hsh":"18a660fd59de7556a2f2c492994e64ff","drk":1,"top":1,"bot":1,"hs":[]},{"startdate":"20210416","fullstartdate":"202104160700","enddate":"20210417","url":"/th?id=OHR.FlowerTown_ROW3852044104_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.FlowerTown_ROW3852044104","copyright":"Dinan, Brittany, France (© Scott Wilson/Alamy)","copyrightlink":"https://www.bing.com/search?q=dinan+brittany&form=hpcapt&filters=HpDate%3a%2220210416_0700%22","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210416_FlowerTown%22&FORM=HPQUIZ","wp":true,"hsh":"8e0169391f82222ebe150ae4d754a92c","drk":1,"top":1,"bot":1,"hs":[]},{"startdate":"20210415","fullstartdate":"202104150700","enddate":"20210416","url":"/th?id=OHR.AlbertaTrunks_ROW3515049267_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.AlbertaTrunks_ROW3515049267","copyright":"Abraham Lake, Alberta, Canada (© Coolbiere/Getty Images)","copyrightlink":"javascript:void(0)","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210415_AlbertaTrunks%22&FORM=HPQUIZ","wp":true,"hsh":"fc7f7dd0ef00938e5a92faaededf774f","drk":1,"top":1,"bot":1,"hs":[]},{"startdate":"20210414","fullstartdate":"202104140700","enddate":"20210415","url":"/th?id=OHR.CarrizoPlain_ROW1847102473_1920x1080.jpg&rf=LaDigue_1920x1080.jpg&pid=hp","urlbase":"/th?id=OHR.CarrizoPlain_ROW1847102473","copyright":"Carrizo Plain National Monument, California, USA (© Dennis Frates/Alamy)","copyrightlink":"javascript:void(0)","title":"Info","quiz":"/search?q=Bing+homepage+quiz&filters=WQOskey:%22HPQuiz_20210414_CarrizoPlain%22&FORM=HPQUIZ","wp":true,"hsh":"3f611399f912b40898883498e272e20d","drk":1,"top":1,"bot":1,"hs":[]}';
        oldJsonImages += ']';
        Utils.mergeImageLists(this._settings, JSON.parse(oldJsonImages));
        */
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
            this._restartTimeout(this._settings.get_int('random-interval')); // we update image every hour by default
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
            let resolution = Utils.getResolution(this._settings, image);
            let BingWallpaperDir = Utils.getWallpaperDir(this._settings);
            this.imageURL = BingURL+image.urlbase+"_"+resolution+".jpg"; // generate image url for user's resolution
            this.filename = BingWallpaperDir+image.startdate+'-'+this.imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '');
            
            let file = Gio.file_new_for_path(this.filename);
            let file_exists = file.query_exists(null);
            let file_info = file_exists ? file.query_info ('*',Gio.FileQueryInfoFlags.NONE,null): 0;

            if (!file_exists || file_info.get_size () == 0) { // file doesn't exist or is empty (probably due to a network error)
                let dir = Gio.file_new_for_path(BingWallpaperDir);
                if (!dir.query_exists(null)) {
                    dir.make_directory_with_parents(null);
                }
                this._downloadImage(this.imageURL, file);
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
    _downloadImage: function(url, file) {
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
                this._addToPreviousQueue(this.filename);
            } else {
                log("Couldn't fetch image from " + url);
                file.delete(null);
            }
        }));
    },

    // add image to persistant list so we can delete it later (in chronological order), delete the oldest image (if user wants this)
    _addToPreviousQueue: function (filename) {
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
    _openInSystemViewer: function () {
        const context = global.create_app_launch_context(0, -1);
        Gio.AppInfo.launch_default_for_uri('file://'+this.filename, context);
    },

    stop: function () {
        if (this._timeout)
            Mainloop.source_remove(this._timeout);
        this._timeout = undefined;
        this.menu.removeAll();
    }
});

function init(extensionMeta) {
    Convenience.initTranslations("BingWallpaper");
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

function toFilename(wallpaperDir, startdate, imageURL, resolution) {
    return wallpaperDir+startdate+'-'+imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '')+"_"+resolution+".jpg";;
}

