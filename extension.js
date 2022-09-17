// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2022 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

imports.gi.versions.Soup = "2.4";

const {St, Soup, Gio, GObject, GLib, Clutter, Cogl, Gdk} = imports.gi;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Util = imports.misc.util;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ByteArray = imports.byteArray;

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
const BingURL = 'https://www.bing.com';
const IndicatorName = 'BingWallpaperIndicator';
const TIMEOUT_SECONDS = 24 * 3600; // FIXME: this should use the end data from the json data
const TIMEOUT_SECONDS_ON_HTTP_ERROR = 1 * 3600; // retry in one hour if there is a http error
const ICON_PREVIOUS_BUTTON = 'media-seek-backward-symbolic';
const ICON_SHUFFLE_BUTTON = 'media-playlist-shuffle-symbolic';
const ICON_CONSEC_BUTTON = 'media-playlist-consecutive-symbolic';
const ICON_NEXT_BUTTON = 'media-seek-forward-symbolic';
const ICON_CURRENT_BUTTON = 'media-skip-forward-symbolic';
const ICON_TIMED_MODE_BUTTON = 'document-open-recent-symbolic';
const ICON_PAUSE_MODE_BUTTON = 'media-playback-pause-symbolic';
const ICON_PLAY_MODE_BUTTON = 'media-playback-start-symbolic';
const ICON_REFRESH = 'view-refresh-symbolic';


let autores; // automatically selected resolution
let bingWallpaperIndicator = null;
let blur = null;
let blur_brightness = 0.55;
let blur_strength = 30;
let carousel = null;

// remove this when dropping support for < 3.33, see https://github.com/OttoAllmendinger/
const getActorCompat = (obj) =>
    Convenience.currentVersionGreaterEqual('3.33') ? obj : obj.actor;

function log(msg) {
    if (bingWallpaperIndicator && bingWallpaperIndicator._settings.get_boolean('debug-logging'))
        print('BingWallpaper extension: ' + msg); // disable to keep the noise down in journal
}

function notifyError(msg) {
    Main.notifyError("BingWallpaper extension error", msg);
}

function doSetBackground(uri, schema) {
    let gsettings = new Gio.Settings({schema: schema});
    let prev = gsettings.get_string('picture-uri');
    uri = 'file://' + uri;
    gsettings.set_string('picture-uri', uri);
    try {
        gsettings.set_string('picture-uri-dark', uri);
    }
    catch (e) {
        log("unable to set dark background for : " + e);
    }
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
        this.imageIndex = null;
        this.logger = null;
        blur = new Blur.Blur();
        blur.blur_strength = 30;
        blur.blur_brightness = 0.55;

        // take a variety of actions when the gsettings values are modified by prefs
        this._settings = ExtensionUtils.getSettings(Utils.BING_SCHEMA);

        this._initSoup();

        getActorCompat(this).visible = !this._settings.get_boolean('hide');

        // enable testing potentially unsafe features on Wayland if the user overrides it
        if (!Utils.is_x11() && this._settings.get_boolean('override-unsafe-wayland')) {
            Utils.is_x11 = Utils.enabled_unsafe;
        }

        this.refreshDueItem = new PopupMenu.PopupMenuItem(_("<No refresh scheduled>"));
        this._wrapLabelItem(this.refreshDueItem);
        //this.showItem = new PopupMenu.PopupMenuItem(_("Show description"));
        this.titleItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh...")); //FIXME: clean this up
        this._wrapLabelItem(this.titleItem);
        this.explainItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh..."));
        this._wrapLabelItem(this.explainItem);
        this.controlItem = new PopupMenu.PopupMenuItem(""); // blank
        this.copyrightItem = new PopupMenu.PopupMenuItem(_("Awaiting refresh..."));
        this._wrapLabelItem(this.copyrightItem);
        this.clipboardImageItem = new PopupMenu.PopupMenuItem(_("Copy image to clipboard"));
        this.clipboardURLItem = new PopupMenu.PopupMenuItem(_("Copy image URL to clipboard"));
        this.folderItem = new PopupMenu.PopupMenuItem(_("Open image folder"));
        this.dwallpaperItem = new PopupMenu.PopupMenuItem(_("Set background image"));
        this.swallpaperItem = new PopupMenu.PopupMenuItem(_("Set lock screen image"));
        this.refreshItem = new PopupMenu.PopupMenuItem(_("Refresh Now"));
        this.settingsItem = new PopupMenu.PopupMenuItem(_("Settings"));
        this.thumbnailItem = new PopupMenu.PopupBaseMenuItem({ style_class: 'wp-thumbnail-image'}); 
        this.menu.addMenuItem(this.refreshItem);
        this.menu.addMenuItem(this.refreshDueItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.explainItem);

        // build the button bar
        this.menu.addMenuItem(this.controlItem);
        this.prevBtn = this._newMenuIcon(
            ICON_PREVIOUS_BUTTON, 
            this.controlItem, 
            this._prevImage);
        this.refreshBtn = this._newMenuIcon(
            ICON_REFRESH, 
            this.controlItem, 
            this._shuffleImage); 
        this.nextBtn = this._newMenuIcon(
            ICON_NEXT_BUTTON, 
            this.controlItem, 
            this._nextImage);
        this.curBtn = this._newMenuIcon(
            ICON_CURRENT_BUTTON, 
            this.controlItem, 
            this._curImage);
        this.randomBtn = this._newMenuIcon(
            this._settings.get_string('selected-image') == 'random' ? ICON_SHUFFLE_BUTTON: ICON_CONSEC_BUTTON, 
            this.controlItem, 
            this._toggleShuffle, 
            6);
        this.modeBtn = this._newMenuIcon(
            this._settings.get_boolean('revert-to-current-image') ? ICON_PLAY_MODE_BUTTON : ICON_PAUSE_MODE_BUTTON, 
            this.controlItem, 
            this._togglePause);
        
        this.menu.addMenuItem(this.thumbnailItem);
        this.menu.addMenuItem(this.titleItem);
        this.menu.addMenuItem(this.copyrightItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        if (this.clipboard.clipboard) { // only if we have a clipboard
            this.menu.addMenuItem(this.clipboardImageItem);
            this.clipboardImageItem.connect('activate', this._copyImageToClipboard.bind(this));
            this.menu.addMenuItem(this.clipboardURLItem);
            this.clipboardURLItem.connect('activate', this._copyURLToClipboard.bind(this));
        }
        this.menu.addMenuItem(this.folderItem);
        this.menu.addMenuItem(this.dwallpaperItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.settingsItem);
        this.explainItem.setSensitive(false);
        this.copyrightItem.setSensitive(false);
        this.refreshDueItem.setSensitive(false);
        this.thumbnailItem.setSensitive(false);
        
        this._setConnections();
        this.thumbnailItem.connect('activate', this._openInSystemViewer.bind(this));
        this.titleItem.connect('activate', () => {
            if (this.imageinfolink)
                Utils.openInSystemViewer(this.imageinfolink, false);
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

    // create soup Session
    _initSoup() {
        this.httpSession = new Soup.Session();
        this.httpSession.user_agent = 'User-Agent: Mozilla/5.0 (X11; GNOME Shell/' + imports.misc.config.PACKAGE_VERSION + '; Linux x86_64; +https://github.com/neffo/bing-wallpaper-gnome-extension ) BingWallpaper Gnome Extension/' + Me.metadata.version;
    }

    // listen for configuration changes
    _setConnections() {
        this._settings.connect('changed::hide', () => {
            getActorCompat(this).visible = !this._settings.get_boolean('hide');
        });
        this._setIcon();
        this._settings.connect('changed::icon-name', this._setIcon.bind(this));
        this._settings.connect('changed::market', this._refresh.bind(this));
        this._settings.connect('changed::set-background', this._setBackground.bind(this));
        this._settings.connect('changed::set-lockscreen', this._setBackground.bind(this));
        this._settings.connect('changed::override-lockscreen-blur', this._setBlur.bind(this));
        this._settings.connect('changed::lockscreen-blur-strength', blur.set_blur_strength.bind(this, this._settings.get_int('lockscreen-blur-strength')));
        this._settings.connect('changed::lockscreen-blur-brightness', blur.set_blur_brightness.bind(this, this._settings.get_int('lockscreen-blur-brightness')));
        this._setBlur();
        this._settings.connect('changed::selected-image', this._setImage.bind(this));
        this._setImage();
        this._settings.connect('changed::delete-previous', this._cleanUpImages.bind(this));
        this._settings.connect('changed::notify', this._notifyCurrentImage.bind(this));
        this._settings.connect('changed::always-export-bing-json', this._exportData.bind(this));
        this._settings.connect('changed::bing-json', this._exportData.bind(this));
        this._cleanUpImages();
    }  

    _openPrefs() {
        ExtensionUtils.openPrefs();
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
        let maxlongdate = Utils.getMaxLongDate(this._settings);
        this.refreshduetext = 
            _("Next refresh") + ": " + (this.refreshdue ? this.refreshdue.format("%X") : '-') + " (" + Utils.friendly_time_diff(this.refreshdue) + "), " + 
            _("Last") + ": " + (maxlongdate? this._localeDate(maxlongdate, true) : '-');
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
        log('selected image changed to: ' + this.selected_image);
        this._selectImage();
    }

    _notifyCurrentImage() {
        if (this._settings.get_boolean('notify')) {
            let image = this._getCurrentImage();
            if (image) {
                this._createNotification(image);
            }
        }
    }

    // set indicator icon (tray icon)
    _setIcon() {
        Utils.validate_icon(this._settings);
        let icon_name = this._settings.get_string('icon-name');
        let gicon = Gio.icon_new_for_string(Me.dir.get_child('icons').get_path() + '/' + icon_name + '.svg');
        this.icon = new St.Icon({gicon: gicon, style_class: 'system-status-icon'});
        log('Replace icon set to: ' + icon_name);
        getActorCompat(this).remove_all_children();
        getActorCompat(this).add_child(this.icon);
    }

    // set backgrounds as requested and set preview image in menu
    _setBackground() {
        if (this.filename == '')
            return;
        this.thumbnail = new Thumbnail.Thumbnail(this.filename); // historically thumbnails were a bit unsafe on Wayland, but now fixed
        this._setThumbnailImage();
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
        let refreshDue = Utils.dateFromLongDate(longdate, 86400).to_local();
        let now = GLib.DateTime.new_now_local();
        let difference = refreshDue.difference(now) / 1000000;
        log('Next refresh due ' + difference + ' seconds from now');
        if (difference < 60 || difference > 86400) // clamp to a reasonable range
            difference = 60;

        difference = difference + 300; // 5 minute fudge offset in case of inaccurate local clock
        this._restartTimeout(difference);
    }

    // convert longdate format into human friendly format
    _localeDate(longdate, include_time = false) {
        let date = Utils.dateFromLongDate(longdate, 300); // date at update
        return date.to_local().format('%Y-%m-%d' + (include_time? ' %X' : '')); // ISO 8601 - https://xkcd.com/1179/
    }

    // set menu text in lieu of a notification/popup
    _setMenuText() {
        this.titleItem.label.set_text(this.title ? this.title : '');
        this.explainItem.label.set_text(this.explanation ? this.explanation : '');
        this.copyrightItem.label.set_text(this.copyright ? this.copyright : '');
    }

    _wrapLabelItem(menuItem) {
        let clutter_text = menuItem.label.get_clutter_text();
        clutter_text.set_line_wrap(true);
        clutter_text.set_ellipsize(0);
        clutter_text.set_max_length(0);
        menuItem.label.set_style('max-width: 420px;');
    }

    _newMenuIcon(icon_name, parent, fn, position = null) {
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
        if (position) {
            getActorCompat(parent).insert_child_at_index(iconBtn, position);
        }
        else {
            getActorCompat(parent).add_child(iconBtn);
        }
            
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
        let scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        log('scale factor: ' + scale_factor);
        getActorCompat(this.thumbnailItem).set_size(480*scale_factor, 270*scale_factor);
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

    _shuffleImage() {
        this._selectImage(true);
    }

    _togglePause() {
        this._settings.set_boolean('revert-to-current-image', !this._settings.get_boolean('revert-to-current-image'));
        getActorCompat(this.controlItem.remove_child(this.modeBtn));
        this.modeBtn = this._newMenuIcon(
            this._settings.get_boolean('revert-to-current-image') ? ICON_PLAY_MODE_BUTTON : ICON_PAUSE_MODE_BUTTON, 
            this.controlItem, 
            this._togglePause);
        log('switched mode to ' + this._settings.get_boolean('revert-to-current-image'));
    }

    _toggleShuffle() {
        if (this._settings.get_string('selected-image') == 'random') {
            this._settings.set_string('selected-image', 'current');
        }
        else {
            this._settings.set_string('selected-image', 'random');
        }
        getActorCompat(this.controlItem.remove_child(this.randomBtn));
        this.randomBtn = this._newMenuIcon(
            this._settings.get_string('selected-image') == 'random'? ICON_SHUFFLE_BUTTON: ICON_CONSEC_BUTTON, 
            this.controlItem, 
            this._toggleShuffle, 
            6);
        log('switched mode to ' + this._settings.get_boolean('revert-to-current-image'));
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

    _getCurrentImage() {
        let imageList = Utils.getImageList(this._settings);
        let curIndex = Utils.getCurrentImageIndex(imageList);
        return Utils.getImageByIndex(imageList, curIndex);
    }

    // download Bing metadata
    _refresh() {
        if (this._updatePending)
            return;
        this._updatePending = true;
        this._restartTimeout();
        let market = this._settings.get_string('market');
        //this._initSoup(); // get new session, incase we aren't detecting proxy changes
        // create an http message
        let url = BingImageURL + (market != 'auto' ? market : '');
        let request = Soup.Message.new('GET', url);
        request.request_headers.append('Accept', 'application/json');
        log('fetching: ' + url);

        // queue the http request
        try {
            this.httpSession.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                this._processMessageRefresh(message);
            });
        }
        catch (error) {
            log('unable to send libsoup json message '+error);
        }
    }

    _processMessageRefresh(message) {
        let status_code = (Soup.MAJOR_VERSION >= 3) ? 
            message.get_status(): // Soup3
            message.status_code; // Soup2
        
        if (status_code == 200) {
            let data = (Soup.MAJOR_VERSION >= 3) ? 
                this.httpSession.send_and_read_finish(message).get_data(): // Soup3
                message.response_body.data; // Soup 2
            log('Recieved ' + data.length + ' bytes');
            this._parseData(data);
            if (this.selected_image != 'random')
                this._selectImage();
        }
        else {
            log('Network error occured: ' + error);
            this._updatePending = false;
            this._restartTimeout(TIMEOUT_SECONDS_ON_HTTP_ERROR);
        }
    }

    // sets a timer for next refresh of Bing metadata
    _restartTimeout(seconds = null) {
        if (this._timeout)
            GLib.source_remove(this._timeout);
        if (seconds == null)
            seconds = TIMEOUT_SECONDS;
        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, this._refresh.bind(this));
        let localTime = GLib.DateTime.new_now_local().add_seconds(seconds);
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

    // auto export Bing data to JSON file if requested
    _exportData() {
        if (this._settings.get_boolean('always-export-bing-json')) { // save copy of current JSON
            Utils.exportBingJSON(this._settings);
        }
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
            Utils.purgeImages(this._settings); // delete older images if enabled
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

    _cleanUpImages() {
        if (this._settings.get_boolean('delete-previous')) {
            Utils.purgeImages(this._settings);
        }
    }

    _createNotification(image) {
        // set notifications icon
        let source = new MessageTray.Source('Bing Wallpaper', 'preferences-desktop-wallpaper-symbolic');
        Main.messageTray.add(source);
        let msg = _('Bing Wallpaper of the Day for') + ' ' + this._localeDate(image.longstartdate);
        let details = Utils.getImageTitle(image);
        let notification = new MessageTray.Notification(source, msg, details);
        notification.setTransient(this._settings.get_boolean('transient'));
        source.showNotification(notification);
    }

    _selectImage(force_shuffle = false) {
        let imageList = JSON.parse(this._settings.get_string('bing-json'));
        let image = null;
        // special values, 'current' is most recent (default mode), 'random' picks one at random, anything else should be filename
        if (this.selected_image == 'random' || force_shuffle) {
            this.imageIndex = Utils.getRandomInt(imageList.length);
            image = imageList[this.imageIndex];
            this._restartShuffleTimeout();
        } else if (this.selected_image == 'current') {
            image = Utils.getCurrentImage(imageList);
            this.imageIndex = Utils.getCurrentImageIndex(imageList);
        } else {
            image = Utils.inImageList(imageList, this.selected_image);
            log('_selectImage: ' + this.selected_image + ' = ' + image ? image.urlbase : 'not found');
            if (!image) // if we didn't find it, try for current
                image = Utils.getCurrentImage(imageList);
            this.imageIndex = Utils.imageIndex(imageList, image.urlbase);
        }
        if (!image)
            return; // could force, image = imageList[0] or perhaps force refresh

        if (image.url != '') {
            this.title = image.copyright.replace(/\s*[\(\（].*?[\)\）]\s*/g, '');
            this.explanation = _('Bing Wallpaper of the Day for') + ' ' + this._localeDate(image.startdate);
            if (this._settings.get_boolean('show-count-in-image-title'))
                this.explanation += ' [' + (this.imageIndex + 1) + '/' + imageList.length + ']';
            this.copyright = image.copyright.match(/[\(\（]([^)]+)[\)\）]/)[1].replace('\*\*', ''); // Japan locale uses （） rather than ()
            this.longstartdate = image.fullstartdate;
            this.imageinfolink = image.copyrightlink.replace(/^http:\/\//i, 'https://');
            let resolution = Utils.getResolution(this._settings, image);
            let BingWallpaperDir = Utils.getWallpaperDir(this._settings);
            this.imageURL = BingURL + image.urlbase + '_' + resolution + '.jpg'; // generate image url for user's resolution
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
                this._setBackground();
                this._updatePending = false;
            }
        } 
        else {
            this.title = _("No wallpaper available");
            this.explanation = _("No picture for today.");
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
            // patch for relative paths, ensures that users running git version don't end up with broken state - see EGO review for version 38 https://extensions.gnome.org/review/30299
            this._settings.set_string('download-folder', this._settings.get_string('download-folder').replace('$HOME', '~'));
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
            log('bad state - refreshing... error was ' + error);
        }
        this._restartTimeout(60);
    }

    // download and process new image
    // FIXME: improve error handling
    _downloadImage(url, file) {
        log("Downloading " + url + " to " + file.get_uri());
        let request = Soup.Message.new('GET', url);

        // queue the http request
        try {
            this.httpSession.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                // request completed
                this._updatePending = false;
                this._processFileDownload(message, file);
            });
        }
        catch (error) {
            log('error sending libsoup message '+error);
        }
    }

    _processFileDownload(message, file) {
        let status_code = (Soup.MAJOR_VERSION >= 3) ? 
            message.get_status(): // Soup3
            message.status_code; // Soup2
        
        if (status_code == 200) {
            let data = (Soup.MAJOR_VERSION >= 3) ? 
                this.httpSession.send_and_read_finish(message).get_data():
                message.response_body.flatten().get_as_bytes();

            file.replace_contents_bytes_async(
                data,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
                (file, res) => {
                    try {
                        file.replace_contents_finish(res);
                        this._setBackground();
                        log('Download successful');
                    } 
                    catch(e) {
                        log('Error writing file: ' + e);
                    }
                }
            );
        }
        else {
            log('Unable download image '+e);
        }
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
    ExtensionUtils.initTranslations("BingWallpaper");
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
    return wallpaperDir + startdate + '-' + imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + '_' + resolution + '.jpg';
}

