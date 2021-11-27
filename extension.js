// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2021 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

const {St, Soup, Gio, GObject, GLib, Clutter, Cogl, Gdk} = imports.gi;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Util = imports.misc.util;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

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
const ICON_PREVIOUS_BUTTON = 'media-seek-backward-symbolic';
const ICON_SHUFFLE_BUTTON = 'media-playlist-shuffle-symbolic';
const ICON_NEXT_BUTTON = 'media-seek-forward-symbolic';
const ICON_CURRENT_BUTTON = 'media-skip-forward-symbolic';

let validresolutions = ['800x600', '1024x768', '1280x720', '1280x768', '1366x768', '1920x1080', '1920x1200', 'UHD'];

let autores; // automatically selected resolution

let bingWallpaperIndicator = null;
let blur = null;
let blur_brightness = 0.55;
let blur_strength = 30;
let carousel = null;

// remove this when dropping support for < 3.33, see https://github.com/OttoAllmendinger/
const getActorCompat = (obj) =>
    Convenience.currentVersionGreaterEqual("3.33") ? obj : obj.actor;

function log(msg) {
    if (bingWallpaperIndicator == null || bingWallpaperIndicator._settings.get_boolean('debug-logging'))
        print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
}

function notifyError(msg) {
    Main.notifyError("BingWallpaper extension error", msg);
}

function doSetBackground(uri, schema) {
    let gsettings = new Gio.Settings({schema: schema});
    let prev = gsettings.get_string('picture-uri');
    uri = 'file://' + uri;
    gsettings.set_string('picture-uri', uri);
    gsettings.set_string('picture-options', 'zoom');
    Gio.Settings.sync();
    gsettings.apply();
    return (prev != uri); // return true if background uri has changed
}

const BingWallpaperIndicator = GObject.registerClass(
class BingWallpaperIndicator extends PanelMenu.Button {
    _init(params = {}) {
        super._init(0, IndicatorName, false);

        this.title = "";
        this.explanation = "";
        this.filename = "";
        this.copyright = "";
        this.version = "0.1";
        this._updatePending = false;
        this._timeout = null;
        this._shuffleTimeout = null;
        this.longstartdate = null;
        this.imageURL = ""; // link to image itself
        this.imageinfolink = ""; // link to Bing photo info page
        this.refreshdue = 0;
        this.refreshduetext = "";
        this.thumbnail = null;
        this.thumbnailItem = null;
        this.selected_image = "current";
        this.clipboard = new BWClipboard.BWClipboard();
        blur = new Blur.Blur();
        blur.blur_strength = 30;
        blur.blur_brightness = 0.55;

        // take a variety of actions when the gsettings values are modified by prefs
        this._settings = Utils.getSettings();

        this.httpSession = new Soup.SessionAsync();
        Soup.Session.prototype.add_feature.call(this.httpSession, new Soup.ProxyResolverDefault());

        getActorCompat(this).visible = !this._settings.get_boolean('hide');

        // enable unsafe features on Wayland if the user overrides it
        if (!Utils.is_x11() && this._settings.get_boolean('override-unsafe-wayland')) {
            Utils.is_x11 = Utils.enabled_unsafe;
        }

        this.refreshDueItem = new PopupMenu.PopupMenuItem(_("<No refresh scheduled>"));
        //this.showItem = new PopupMenu.PopupMenuItem(_("Show description"));
        this.titleItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh...")); //FIXME: clean this up
        this._wrapLabelItem(this.titleItem);
        this.explainItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh..."));
        this._wrapLabelItem(this.explainItem);
        this.controlItem = new PopupMenu.PopupMenuItem(""); // blank
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
        if (Utils.is_x11()) { // causes crashes when XWayland is not available, ref github #82, now fixed
            this.thumbnailItem = new PopupMenu.PopupBaseMenuItem(); 
        }
        else {
            this.thumbnailItem = new PopupMenu.PopupMenuItem(_("Thumbnail disabled on Wayland"));
            log('X11 not detected, disabling some unsafe features');
        }
        this.menu.addMenuItem(this.refreshItem);
        this.menu.addMenuItem(this.refreshDueItem);
        this.menu.addMenuItem(this.explainItem);
        this.menu.addMenuItem(this.controlItem);
        this.prevBtn = this._newMenuIcon(ICON_PREVIOUS_BUTTON, this.controlItem, this._prevImage);
        this.randomBtn = this._newMenuIcon(ICON_SHUFFLE_BUTTON, this.controlItem, this._setRandom);
        this.nextBtn = this._newMenuIcon(ICON_NEXT_BUTTON, this.controlItem, this._nextImage);
        this.curBtn = this._newMenuIcon(ICON_CURRENT_BUTTON, this.controlItem, this._curImage);
        this.menu.addMenuItem(this.thumbnailItem);
        this.menu.addMenuItem(this.titleItem);
        this.menu.addMenuItem(this.copyrightItem);
        //this.menu.addMenuItem(this.showItem);
        this.menu.addMenuItem(this.separator);
        this._setConnections();
        if (Utils.is_x11() && this.clipboard.clipboard) { // these may not work on Wayland atm, check to see if it's working
            // currently non functional
            this.menu.addMenuItem(this.clipboardImageItem);
            this.clipboardImageItem.connect('activate', this._copyImageToClipboard.bind(this));
            this.menu.addMenuItem(this.clipboardURLItem);
            this.clipboardURLItem.connect('activate', this._copyURLToClipboard.bind(this));
        }

        this.menu.addMenuItem(this.folderItem);
        this.menu.addMenuItem(this.dwallpaperItem);
        if (!Convenience.currentVersionGreaterEqual("3.36")) { // lockscreen and desktop wallpaper are the same in GNOME 3.36+
            this.menu.addMenuItem(this.swallpaperItem);
            this.swallpaperItem.connect('activate', this._setBackgroundScreensaver.bind(this));
        }
            
        this.menu.addMenuItem(this.settingsItem);
        this.explainItem.setSensitive(false);
        this.copyrightItem.setSensitive(false);
        this.refreshDueItem.setSensitive(false);
        this.thumbnailItem.setSensitive(false);
        this.thumbnailItem.connect('activate', this._openInSystemViewer.bind(this));
        this.titleItem.connect('activate', () => {
            if (this.imageinfolink)
                Util.spawn(["xdg-open", this.imageinfolink]);
        });
        this.folderItem.connect('activate', Utils.openImageFolder.bind(this, this._settings));
        this.dwallpaperItem.connect('activate', this._setBackgroundDesktop.bind(this));
        this.refreshItem.connect('activate', this._refresh.bind(this));
        this.settingsItem.connect('activate', this._openPrefs.bind(this));
        getActorCompat(this).connect('button-press-event', this._openMenu.bind(this));
        if (this._settings.get_string('state') != '[]') {
            this._reStoreState();
        }
        else {
            this._restartTimeout(60); // wait 60 seconds before performing refresh
        }
    }

        // listen for configuration changes
        _setConnections() {
            this._settings.connect('changed::hide', () => {
                getActorCompat(this).visible = !this._settings.get_boolean('hide');
            });
            this._setIcon(this._settings.get_string('icon-name'));
            this._settings.connect('changed::icon-name', this._setIcon.bind(this, this._settings.get_string('icon-name')));
            this._settings.connect('changed::market', this._refresh.bind(this));
            this._settings.connect('changed::set-background', this._setBackground.bind(this));
            this._settings.connect('changed::set-lockscreen', this._setBackground.bind(this));
            this._settings.connect('changed::override-lockscreen-blur', this._setBlur.bind(this));
            this._settings.connect('changed::lockscreen-blur-strength', blur.set_blur_strength.bind(this, this._settings.get_int('lockscreen-blur-strength')));
            this._settings.connect('changed::lockscreen-blur-brightness', blur.set_blur_brightness.bind(this, this._settings.get_int('lockscreen-blur-brightness')));
            this._setBlur();
            this._settings.connect('changed::selected-image', this._setImage.bind(this));
            this._setImage();
        }
    

    _openPrefs() {
        try {
            ExtensionUtils.openPrefs();
        }
        catch (e) {
            log('Falling back to Util.spawn to launch extensions...');
            if (Convenience.currentVersionSmaller("3.36"))
                Util.spawn(['gnome-shell-extension-prefs', Me.metadata.uuid]); // fall back for older gnome versions
            else 
                Util.spawn(["gnome-extensions", "prefs", Me.metadata.uuid]);
        }
    }

    _openMenu() {
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
        this.refreshduetext = _("Next refresh") + ": " + (this.refreshdue ? this.refreshdue.format("%X") : '-') + " (" + Utils.friendly_time_diff(this.refreshdue) + ")";
        this.refreshDueItem.label.set_text(this.refreshduetext);
    }

    _setBlur() {
        blur._switch(this._settings.get_boolean('override-lockscreen-blur'));
        blur.set_blur_strength(this._settings.get_int('lockscreen-blur-strength'));
        blur.set_blur_brightness(this._settings.get_int('lockscreen-blur-brightness'));
    }

    _setImage() {
        Utils.validate_imagename(this._settings);
        this.selected_image = this._settings.get_string('selected-image');
        log('selected image changed to :' + this.selected_image);
        this._selectImage();
    }

    // set indicator icon (tray icon)
    _setIcon(icon_name) {
        //log('Icon set to : '+icon_name)
        Utils.validate_icon(this._settings);
        let gicon = Gio.icon_new_for_string(Me.dir.get_child('icons').get_path() + "/" + icon_name + ".svg");
        this.icon = new St.Icon({gicon: gicon, style_class: 'system-status-icon'});
        log('Replace icon set to : ' + icon_name);
        getActorCompat(this).remove_all_children();
        getActorCompat(this).add_child(this.icon);
    }

    // set backgrounds as requested and set preview image in menu
    _setBackground() {
        if (this.filename == "")
            return;
        if (Utils.is_x11()) { // wayland - only if we are sure it's safe to do so, we can't know if xwayland is running
            this.thumbnail = new Thumbnail.Thumbnail(this.filename);
            this._setThumbnailImage();
        }

        if (this._settings.get_boolean('set-background'))
            this._setBackgroundDesktop();

        if (this._settings.get_boolean('set-lock-screen'))
            this._setBackgroundScreensaver();
    }

    _setBackgroundDesktop() {
        doSetBackground(this.filename, Utils.DESKTOP_SCHEMA);
    }
    
    _setBackgroundScreensaver() {
        doSetBackground(this.filename, Utils.LOCKSCREEN_SCHEMA);
    }

    _copyURLToClipboard() {
        this.clipboard.setText(this.imageURL);
    }

    _copyImageToClipboard() {
        this.clipboard.setImage(this.filename);
    }

    // set a timer on when the current image is going to expire
    _restartTimeoutFromLongDate(longdate) {
        // all bing times are in UTC (+0)
        let refreshDue = Utils.dateFromLongDate(longdate, 86400);
        let timezone = GLib.TimeZone.new_local();
        let now = GLib.DateTime.new_now(timezone);
        let difference = refreshDue.difference(now) / 1000000;

        log("Next refresh due @ " + refreshDue.format('%F %R %z') + " = " + difference + " seconds from now (" + now.format('%F %R %z') + ")");

        if (difference < 60 || difference > 86400) // something wierd happened
            difference = 60;

        difference = difference + 300; // 5 minute fudge offset in case of inaccurate local clock
        this._restartTimeout(difference);
    }

    // convert shortdate format into human friendly format
    _localeDate(shortdate) {
        let date = Utils.dateFromShortDate(shortdate);
        return date.format('%Y-%m-%d'); // ISO 8601 - https://xkcd.com/1179/
    }

    // set menu text in lieu of a notification/popup
    _setMenuText() {
        this.titleItem.label.set_text(this.title ? this.title : '');
        this.explainItem.label.set_text(this.explanation ? this.explanation : '');
        this.copyrightItem.label.set_text(this.copyright ? this.copyright : '');
    }

    _wrapLabelItem(menuItem) {
        menuItem.label.get_clutter_text().set_line_wrap(true);
        menuItem.label.set_style("max-width: 350px;");
    }

    _newMenuIcon(icon_name, parent, fn) {
        let icon = new St.Icon({
            icon_name: icon_name,
            style_class: 'popup-menu-icon',
            x_expand: false,
            y_expand: false
        });

        let iconBtn = new St.Button({
            style_class: 'ci-action-btn',
            can_focus: true,
            child: icon,
            /* x_align: Clutter.ActorAlign.END, // FIXME: errors on GNOME 3.28, default to center is ok */
            x_expand: true,
            y_expand: true
        });

        getActorCompat(parent).add_child(iconBtn);
        iconBtn.connect('button-press-event', fn.bind(this));
        return iconBtn;
    }

    // set menu thumbnail
    _setThumbnailImage() {
        let pixbuf = this.thumbnail.pixbuf;
        if (pixbuf == null)
            return;
        const {width, height} = pixbuf;
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
    }

    _nextImage() {
        this._gotoImage(1);
    }

    _prevImage() {
        this._gotoImage(-1);
    }

    _curImage() {
        this._settings.set_string('selected-image', 'current');
        this._gotoImage(0);
    }

    _setRandom() {
        if (this._settings.get_string('selected-image') == 'random') {
            // already set to random, so just roll the dice once more
            this._selectImage();
        }
        else {
            // setting this will force a new image selection
            this._settings.set_string('selected-image', 'random');
        }
    }

    _gotoImage(relativePos) {
        let imageList = Utils.getImageList(this._settings);
        let curIndex = 0;
        if (this.selected_image == 'random')
            return;
        if (this.selected_image == 'current') {
            curIndex = Utils.getCurrentImageIndex(imageList);
        }
        else {
            curIndex = Utils.imageIndex(imageList, this.selected_image);
        }
        let newImage = Utils.getImageByIndex(imageList, curIndex + relativePos);
        if (newImage)
            this._settings.set_string('selected-image', newImage.urlbase.replace('/th?id=OHR.', ''));
    }

    // download Bing metadata
    _refresh() {
        if (this._updatePending)
            return;
        this._updatePending = true;

        this._restartTimeout();

        let market = this._settings.get_string('market');
        log("market: " + market);

        // create an http message
        let request = Soup.Message.new('GET', BingImageURL + (market != 'auto' ? market : '')); // + market
        log("fetching: " + BingImageURL + (market != 'auto' ? market : ''));

        // queue the http request
        this.httpSession.queue_message(request, (httpSession, message) => {
            if (message.status_code == 200) {
                let data = message.response_body.data;
                log("Recieved " + data.length + " bytes ");
                this._parseData(data);
                if (this.selected_image != 'random' /*|| !forced*/)
                this._selectImage();
            } else if (message.status_code == 403) {
                log("Access denied: " + message.status_code);
                this._updatePending = false;
                this._restartTimeout(TIMEOUT_SECONDS_ON_HTTP_ERROR);
            } else {
                log("Network error occured: " + message.status_code);
                this._updatePending = false;
                this._restartTimeout(TIMEOUT_SECONDS_ON_HTTP_ERROR);
            }
        });
    }

    // sets a timer for next refresh of Bing metadata
    _restartTimeout(seconds = null) {
        if (this._timeout)
            GLib.source_remove(this._timeout);
        if (seconds == null)
            seconds = TIMEOUT_SECONDS;
        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, this._refresh.bind(this));
        let timezone = GLib.TimeZone.new_local();
        let localTime = GLib.DateTime.new_now(timezone).add_seconds(seconds);
        this.refreshdue = localTime;
        log('next check in ' + seconds + ' seconds @ local time ' + localTime.format('%F %R %z'));
    }

    _restartShuffleTimeout(seconds = null) {
        if (this._shuffleTimeout)
            GLib.source_remove(this._shuffleTimeout);
        if (seconds == null)
            seconds = this._settings.get_int('random-interval');
        this._shuffleTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, this._selectImage.bind(this));
        log('next shuffle in ' + seconds + ' seconds');
    }

    // process Bing metadata
    _parseData(data) {
        try {
            let parsed = JSON.parse(data);
            let datamarket = parsed.market.mkt;
            let prefmarket = this._settings.get_string('market');
            if (datamarket != prefmarket && prefmarket != 'auto')
                log('WARNING: Bing returning market data for ' + datamarket + ' rather than selected ' + prefmarket);
            let newImages = Utils.mergeImageLists(this._settings, parsed.images);
            Utils.purgeImages(this._settings);
            Utils.cleanupImageList(this._settings);
            if (newImages.length > 0 && this._settings.get_boolean('revert-to-current-image')) {
                // user wants to switch to the new image when it arrives
                this._settings.set_string('selected-image', 'current');
            }
            if (this._settings.get_boolean('notify')) {
                newImages.forEach((image, index) => {
                    log('New image to notify: ' + Utils.getImageTitle(image));
                    this._createNotification(image);
                });
            }

            this._restartTimeoutFromLongDate(parsed.images[0].fullstartdate); // timing is set by Bing, and possibly varies by market
            this._updatePending = false;
        }
        catch (error) {
            log('_parseData() failed with error ' + error);
        }
    }

    _createNotification(image) {
        // set notifications icon
        let source = new MessageTray.Source("Bing Wallpaper", "preferences-desktop-wallpaper-symbolic");
        Main.messageTray.add(source);
        let msg = _("Bing Wallpaper of the Day for") + ' ' + this._localeDate(image.startdate);
        let details = Utils.getImageTitle(image); //image.copyright.replace(/\s*\(.*?\)\s*/g, "");
        let notification = new MessageTray.Notification(source, msg, details);
        notification.setTransient(this._settings.get_boolean('transient'));
        // Add action to open Bing website with default browser, this is unfortunately very hacky
        notification.addAction(_("More info on Bing.com"), this._notificationOpenLink().bind(this, notification));
        source.showNotification(notification);
    }

    _notificationOpenLink(notification) {
        log("Open :" + notification.bannerBodyText);
        let imageList = Utils.getImageList(this._settings);
        let image = Utils.inImageListByTitle(imageList, notification.bannerBodyText);
        Util.spawn(["xdg-open", image.copyrightlink]);
    }

    _selectImage() {
        let imageList = JSON.parse(this._settings.get_string('bing-json'));
        let image = null;
        // special values, 'current' is most recent (default mode), 'random' picks one at random, anything else should be filename
        if (this.selected_image == 'random') {
            image = imageList[Utils.getRandomInt(imageList.length)];
            this._restartShuffleTimeout();
            //this._restartTimeout(this._settings.get_int('random-interval')); // we update image every hour by default
        } else if (this.selected_image == 'current') {
            image = Utils.getCurrentImage(imageList);
        } else {
            image = Utils.inImageList(imageList, this.selected_image);
            log('_selectImage: ' + this.selected_image + ' = ' + image ? image.urlbase : "not found");
            if (!image) // if we didn't find it, try for current
                image = Utils.getCurrentImage(imageList);
        }
        if (!image)
            return; // could force, image = imageList[0] or perhaps force refresh

        if (image.url != '') {
            this.title = image.copyright.replace(/\s*[\(\（].*?[\)\）]\s*/g, "");
            this.explanation = _("Bing Wallpaper of the Day for") + ' ' + this._localeDate(image.startdate);
            this.copyright = image.copyright.match(/[\(\（]([^)]+)[\)\）]/)[1].replace('\*\*', ''); // Japan locale uses （） rather than ()
            this.longstartdate = image.fullstartdate;
            this.imageinfolink = image.copyrightlink.replace(/^http:\/\//i, 'https://');
            let resolution = Utils.getResolution(this._settings, image);
            let BingWallpaperDir = Utils.getWallpaperDir(this._settings);
            this.imageURL = BingURL + image.urlbase + "_" + resolution + ".jpg"; // generate image url for user's resolution
            this.filename = toFilename(BingWallpaperDir, image.startdate, image.urlbase, resolution);
            
            let file = Gio.file_new_for_path(this.filename);
            let file_exists = file.query_exists(null);
            let file_info = file_exists ? file.query_info ('*', Gio.FileQueryInfoFlags.NONE, null) : 0;

            if (!file_exists || file_info.get_size () == 0) { // file doesn't exist or is empty (probably due to a network error)
                let dir = Gio.file_new_for_path(BingWallpaperDir);
                if (!dir.query_exists(null)) {
                    dir.make_directory_with_parents(null);
                }
                this._downloadImage(this.imageURL, file);
            } else {
                log("Image already downloaded");
                this._setBackground();
                this._updatePending = false;
            }
            //this._createNotification(image); // for testing
        } 
        else {
            this.title = _("No wallpaper available");
            this.explanation = _("No picture for today 😞.");
            this.filename = "";
            this._updatePending = false;
        }
        this._setMenuText();
        this._storeState();
    }

    _storeState() {
        if (this.filename) {
            let maxLongDate = Utils.getMaxLongDate(this._settings); // refresh date from most recent Bing image
            let state = {maxlongdate: maxLongDate, title: this.title, explanation: this.explanation, copyright: this.copyright,
                longstartdate: this.longstartdate, imageinfolink: this.imageinfolink, imageURL: this.imageURL,
                filename: this.filename};
            let stateJSON = JSON.stringify(state);
            log('Storing state as JSON: ' + stateJSON);
            this._settings.set_string('state', stateJSON);
        }
    }

    _reStoreState() {
        try {
            log('restoring state...');
            let stateJSON = this._settings.get_string('state');
            let state = JSON.parse(stateJSON);
            let maxLongDate = null;
            maxLongDate = state.maxlongdate ? state.maxlongdate : null;
            this.title = state.title;
            this.explanation = state.explanation;
            this.copyright = state.copyright;
            this.longstartdate = state.longstartdate;
            this.imageinfolink = state.imageinfolink;
            this.imageURL = state.imageURL;
            this.filename = state.filename;
            this._selected_image = this._settings.get_string('selected-image');
            this._setMenuText();
            this._setBackground();
            if (!maxLongDate) {
                this._restartTimeout(60);
                return;
            } 
            if (this.selected_image == 'random') {
                this._setRandom();
                this._restartTimeoutFromLongDate(maxLongDate);
            }
            else {
                this._restartTimeoutFromLongDate(maxLongDate);
            }
            return;
        }
        catch (error) {
            log('bad state - refreshing...');
        }
        this._restartTimeout(60);
    }

    // download and process new image
    // FIXME: improve error handling
    _downloadImage(url, file) {
        log("Downloading " + url + " to " + file.get_uri());

        // open the Gfile
        let fstream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        // create an http message
        let request = Soup.Message.new('GET', url);
        // got_headers event
        request.connect('got_headers', (message) => {
            log("got_headers, status: " + message.status_code);
        });

        // got_chunk event
        request.connect('got_chunk', (message, chunk) => {
            //log("got_chuck, status: "+message.status_code);
            if (message.status_code == 200) { // only save the data we want, not content of 301 redirect page
                fstream.write(chunk.get_data(), null);
            }
            else {
                log("got_chuck, status: " + message.status_code);
            }
        });

        // queue the http request
        this.httpSession.queue_message(request, (httpSession, message) => {
            // request completed
            fstream.close(null);
            this._updatePending = false;
            if (message.status_code == 200) {
                log('Download successful');
                this._setBackground();
            } else {
                log("Couldn't fetch image from " + url);
                file.delete(null);
            }
        });
    }

    // open image in default image view
    _openInSystemViewer() {
        Utils.openInSystemViewer(this.filename);
    }

    stop() {
        if (this._timeout)
            GLib.source_remove(this._timeout);
        if (this._shuffleTimeout)
            GLib.source_remove(this._shuffleTimeout);
        this._timeout = undefined;
        this._shuffleTimeout = undefined;
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
    bingWallpaperIndicator.stop();
    bingWallpaperIndicator.destroy();
    bingWallpaperIndicator = null;
    blur._disable();
    blur = null;
}

function toFilename(wallpaperDir, startdate, imageURL, resolution) {
    return wallpaperDir + startdate + '-' + imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + "_" + resolution + ".jpg";
}

