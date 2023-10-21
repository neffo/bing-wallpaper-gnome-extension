// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2023 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

import St from 'gi://St';
import Soup from 'gi://Soup';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gdk from 'gi://Gdk';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import {Button} from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
const ByteArray = imports.byteArray;

import {Extension, gettext as _, myDir, metadata} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Utils from './utils.js';
import Blur from './blur.js';
import Thumbnail from './thumbnail.js';
import BWClipboard from './BWClipboard.js';
import * as Convenience from './convenience.js';

const BingImageURL = Utils.BingImageURL;
const BingURL = 'https://www.bing.com';
const IndicatorName = 'BingWallpaperIndicator';
const TIMEOUT_SECONDS = 24 * 3600; // FIXME: this should use the end data from the json data
const TIMEOUT_SECONDS_ON_HTTP_ERROR = 1 * 3600; // retry in one hour if there is a http error3
const MINIMUM_SHUFFLE_IMAGES = 3; // bare minimum to use filtered image set in shuffle mode
const ICON_PREVIOUS_BUTTON = 'media-seek-backward-symbolic';
const ICON_SHUFFLE_BUTTON = 'media-playlist-shuffle-symbolic';
const ICON_CONSEC_BUTTON = 'media-playlist-consecutive-symbolic';
const ICON_NEXT_BUTTON = 'media-seek-forward-symbolic';
const ICON_CURRENT_BUTTON = 'media-skip-forward-symbolic';
const ICON_TIMED_MODE_BUTTON = 'document-open-recent-symbolic';
const ICON_PAUSE_MODE_BUTTON = 'media-playback-pause-symbolic';
const ICON_PLAY_MODE_BUTTON = 'media-playback-start-symbolic';
const ICON_REFRESH = 'view-refresh-symbolic';
const ICON_RANDOM = myDir.get_child('icons').get_path() + '/'+'game-die-symbolic.svg';
const ICON_FAVE_BUTTON = myDir.get_child('icons').get_path() + '/'+'fav-symbolic.svg';
const ICON_UNFAVE_BUTTON = myDir.get_child('icons').get_path() + '/'+'unfav-symbolic.svg';
const ICON_TRASH_BUTTON = myDir.get_child('icons').get_path() + '/'+'trash-empty-symbolic.svg';
const ICON_UNTRASH_BUTTON = myDir.get_child('icons').get_path() + '/'+'trash-full-symbolic.svg';

let bingWallpaperIndicator = null;
let blur = null;

// remove this when dropping support for < 3.33, see https://github.com/OttoAllmendinger/
const getActorCompat = (obj) =>
    Convenience.versionGreaterEqual(Config.PACKAGE_VERSION.replace(/(alpha|beta)/,'0'), '3.33') ? obj : obj.actor;

const newMenuItem = (label) => {
    return new PopupMenu.PopupMenuItem(label);
}

const newMenuSwitchItem = (label, state) => {
    let switchItem = new PopupMenu.PopupSwitchMenuItem(
        label, 
        state, 
        {});
    switchItem.label.x_expand = true;
    switchItem._statusBin.x_expand = false;
    return switchItem;
}

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
class BingWallpaperIndicator extends Button {
    _init(ext) {
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
        this.shuffledue = 0;
        this.refreshduetext = "";
        this.thumbnail = null;
        this.thumbnailItem = null;
        this.selected_image = "current";
        this.clipboard = new BWClipboard();
        this.imageIndex = null;
        this.logger = null;
        this.favourite_status = false;
        this.hidden_status = false;
        this.dimensions = { 'width': null, 'height': null};
        this._extension = ext;
        
        let extensionIconsPath = ext.dir.get_child('icons').get_path()
        this.ICON_RANDOM = extensionIconsPath + '/'+'game-die-symbolic.svg';
        this.ICON_FAVE_BUTTON = extensionIconsPath + '/'+'fav-symbolic.svg';
        this.ICON_UNFAVE_BUTTON = extensionIconsPath + '/'+'unfav-symbolic.svg';

        if (!blur) // as Blur isn't disabled on screen lock (like the rest of the extension is)
            blur = new Blur();
        
        // take a variety of actions when the gsettings values are modified by prefs
        this._settings = this._extension.getSettings();

        // create Soup session
        this.httpSession = Utils.initSoup();

        this.visible = !this._settings.get_boolean('hide');

        this.refreshDueItem = newMenuItem(_("<No refresh scheduled>"));
        this.titleItem = new PopupMenu.PopupSubMenuMenuItem(_("Awaiting refresh..."), false);
        this.explainItem = newMenuItem(_("Awaiting refresh..."));
        this.copyrightItem = newMenuItem(_("Awaiting refresh..."));
        this.clipboardImageItem = newMenuItem(_("Copy image to clipboard"));
        this.clipboardURLItem = newMenuItem(_("Copy image URL to clipboard"));
        this.folderItem = newMenuItem(_("Open image folder"));
        this.dwallpaperItem = newMenuItem(_("Set background image"));
        this.swallpaperItem = newMenuItem(_("Set lock screen image"));
        this.refreshItem = newMenuItem(_("Refresh Now"));
        this.settingsItem = newMenuItem(_("Settings"));
        this.openImageItem = newMenuItem(_("Open in image viewer"));
        this.openImageInfoLinkItem = newMenuItem(_("Open Bing image information page"));

        [this.openImageInfoLinkItem, this.openImageItem, this.folderItem,
            this.clipboardImageItem, this.clipboardURLItem, this.dwallpaperItem]
                .forEach(e => this.titleItem.menu.addMenuItem(e));

        // quick settings submenu
        this.settingsSubMenu = new PopupMenu.PopupSubMenuMenuItem(_("Quick settings"), false);
        // toggles under the quick settings submenu
        this.toggleSetBackground = newMenuSwitchItem(_("Set background image"), this._settings.get_boolean('set-background'));
        this.toggleSelectNew = newMenuSwitchItem(_("Always show new images"), this._settings.get_boolean('revert-to-current-image'));
        this.toggleShuffle = newMenuSwitchItem(_("Image shuffle mode"), true);
        this.toggleShuffleOnlyFaves = newMenuSwitchItem(_("Image shuffle only favourites"), this._settings.get_boolean('random-mode-include-only-favourites'));
        this.toggleNotifications = newMenuSwitchItem(_("Enable desktop notifications"), this._settings.get_boolean('notify'));
        this.toggleImageCount = newMenuSwitchItem(_("Show image count"), this._settings.get_boolean('show-count-in-image-title'));
        
        [this.toggleNotifications, this.toggleImageCount, this.toggleSetBackground, this.toggleSelectNew, 
            this.toggleShuffle, this.toggleShuffleOnlyFaves]
                .forEach(e => this.settingsSubMenu.menu.addMenuItem(e));

        // these items are a bit unique, we'll populate them in _setControls()
        this.controlItem = newMenuItem("");
        this.thumbnailItem = new PopupMenu.PopupBaseMenuItem({ style_class: 'wp-thumbnail-image'});       
        this._setControls(); // build the button bar

        // we need to word-wrap these menu items to not overflow menu in case of long lines of text
        [this.refreshDueItem, this.titleItem, this.explainItem, this.copyrightItem]
            .forEach((e, i) => {
                this._wrapLabelItem(e);
            });
        
        // set the order of menu items (including separators)
        let allMenuItems = [ 
            this.refreshItem, 
            this.refreshDueItem, 
            new PopupMenu.PopupSeparatorMenuItem(),
            this.controlItem,
            new PopupMenu.PopupSeparatorMenuItem(),
            this.explainItem, 
            this.thumbnailItem, 
            this.titleItem, 
            this.copyrightItem,
            new PopupMenu.PopupSeparatorMenuItem(),
            this.settingsSubMenu,
            this.settingsItem
        ];
        allMenuItems.forEach(e => this.menu.addMenuItem(e));

        // non clickable information items
        [this.explainItem, this.copyrightItem, this.refreshDueItem, this.thumbnailItem]
            .forEach((e) => {
                e.setSensitive(false);
            });
        
        this._setConnections();
        
        if (this._settings.get_string('state') != '[]') { // setting state on reset or initial boot
            this._reStoreState();
        }
        else {
            this._restartTimeout(60); // wait 60 seconds before performing refresh
        }
    }

    // listen for configuration changes
    _setConnections() {
        this._settings.connect('changed::hide', () => {
            this.visible = !this._settings.get_boolean('hide');
        });
        
        let settingConnections = [
            {signal: 'changed::icon-name', call: this._setIcon},
            {signal: 'changed::market', call: this._refresh},
            {signal: 'changed::set-background', call: this._setBackground},
            /*{signal: 'changed::set-lockscreen', call: this._setBackground},*/
            {signal: 'changed::override-lockscreen-blur', call: this._setBlur},
            {signal: 'changed::selected-image', call: this._setImage},
            {signal: 'changed::delete-previous', call: this._cleanUpImages},
            {signal: 'changed::notify', call: this._notifyCurrentImage},
            {signal: 'changed::always-export-bing-json', call: this._exportData},
            {signal: 'changed::bing-json', call: this._exportData},
            {signal: 'changed::controls-icon-size', call: this._setControls}
        ];

        // _setShuffleToggleState
        settingConnections.forEach((e) => {
            this._settings.connect(e.signal, e.call.bind(this));
        });

        this._settings.connect('changed::lockscreen-blur-strength', blur.set_blur_strength.bind(this, this._settings.get_int('lockscreen-blur-strength')));
        this._settings.connect('changed::lockscreen-blur-brightness', blur.set_blur_brightness.bind(this, this._settings.get_int('lockscreen-blur-brightness')));        
        
        // ensure we're in a sensible initial state
        this._setIcon();
        this._setBlur();
        this._setImage();
        this._cleanUpImages();

        // menu connections 
        this.connect('button-press-event', this._openMenu.bind(this));

        // link menu items to functions
        //this.thumbnailItem.connect('activate', this._setBackgroundDesktop.bind(this));
        this.thumbnailItem.connect('activate', this._openInSystemViewer.bind(this));
        this.openImageItem.connect('activate', this._openInSystemViewer.bind(this));
        //this.titleItem.connect('activate', this._setBackgroundDesktop.bind(this));
        this.openImageInfoLinkItem.connect('activate', this._openImageInfoLink.bind(this)); 
        this.dwallpaperItem.connect('activate', this._setBackgroundDesktop.bind(this));
        this.refreshItem.connect('activate', this._refresh.bind(this));
        this.settingsItem.connect('activate', this._openPrefs.bind(this));
        
        // unfortunately we can't bind like we can with prefs here, so we handle toggles in two steps
        // first, we listen for changes to these toggle settings and update toggles
        this._settings.connect('changed::set-background', () => { 
            this.toggleSetBackground.setToggleState(this._settings.get_boolean('set-background'));
        });
        this._settings.connect('changed::revert-to-current-image', () => { 
            this.toggleSelectNew.setToggleState(this._settings.get_boolean('revert-to-current-image'));
        });
        this._settings.connect('changed::notify', () => { 
            this.toggleNotifications.setToggleState(this._settings.get_boolean('notify'));
        });
        this._settings.connect('changed::show-count-in-image-title', () => { 
            this.toggleImageCount.setToggleState(this._settings.get_boolean('show-count-in-image-title'));
            this._setMenuText();
        });

        // & then, link settings to toggle state (the other way)        
        this.toggleSetBackground.connect('toggled', (item, state) => {
            this._settings.set_boolean('set-background', state);
        });
        this.toggleSelectNew.connect('toggled', (item, state) => {
            this._settings.set_boolean('revert-to-current-image', state);
        });
        this.toggleNotifications.connect('toggled', (item, state) => {
            this._settings.set_boolean('notify', state);
        });
        this.toggleImageCount.connect('toggled', (item, state) => {
            this._settings.set_boolean('show-count-in-image-title', state);
            this._selectImage(false);
        });
        this.toggleShuffleOnlyFaves.connect('toggled', (item, state) => {
            this._settings.set_boolean('random-mode-include-only-favourites', state);
        });
        
        // shuffle is a special case
        this._setShuffleToggleState();
        this.toggleShuffle.connect('toggled', this._toggleShuffle.bind(this));

        this.folderItem.connect('activate', Utils.openImageFolder.bind(this, this._settings));
        if (this.clipboard.clipboard) { // only if we have a clipboard           
            this.clipboardImageItem.connect('activate', this._copyImageToClipboard.bind(this));
            this.clipboardURLItem.connect('activate', this._copyURLToClipboard.bind(this));
        }
        else {
            [this.clipboardImageItem, this.clipboardURLItem].
                forEach(e => e.setSensitive(false));
        }
    }  

    _openPrefs() {
        this._extension.openPreferences();
    }

    _openMenu() {
        // Grey out menu items if an update is pending
        this.refreshItem.setSensitive(!this._updatePending);
        if (Utils.is_x11(this._settings)) {
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
            _("Next refresh") + ": " + (this.refreshdue ? this.refreshdue.format("%Y-%m-%d %X") : '-') + " (" + Utils.friendly_time_diff(this.refreshdue) + ")\n" + 
            _("Last refresh") + ": " + (maxlongdate? this._localeDate(maxlongdate, true) : '-');
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
        this._setShuffleToggleState();
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
        Utils.validate_icon(this._settings, this._extension.path);
        let icon_name = this._settings.get_string('icon-name');
        let gicon = Gio.icon_new_for_string(this._extension.dir.get_child('icons').get_path() + '/' + icon_name + '.svg');
        this.icon = new St.Icon({gicon: gicon, style_class: 'system-status-icon'});
        log('Replace icon set to: ' + icon_name);
        this.remove_all_children();
        this.add_child(this.icon);
    }

    // set backgrounds as requested and set preview image in menu
    _setBackground() {
        if (this.filename == '')
            return;
        this.thumbnail = new Thumbnail.Thumbnail(this.filename, St.ThemeContext.get_for_stage(global.stage).scale_factor); // use scale factor to make them look nicer
        this._setThumbnailImage();
        if (!this.dimensions.width || !this.dimensions.height) // if dimensions aren't in image database yet
            [this.dimensions.width, this.dimensions.height] = Utils.getFileDimensions(this.filename);
        log('image set to : '+this.filename);
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
        // all Bing times are in UTC (+0)
        let refreshDue = Utils.dateFromLongDate(longdate, 86400).to_local();
        let now = GLib.DateTime.new_now_local();
        let difference = refreshDue.difference(now) / 1000000;
             
        if (difference < 60 || difference > 86400) // clamp to a reasonable range
            difference = 60;
        difference = difference + 300; // 5 minute fudge offset in case of inaccurate local clock
        
        log('Next refresh due ' + difference + ' seconds from now');
        this._restartTimeout(difference);
    }

    // alternative shuffle mode, not yet enabled
    _restartShuffleTimeoutFromDueDate(duedate) {
        let now = GLib.DateTime.new_now_local();
        let difference = duedate.difference(now) / 1000000;
        if (difference < 60 || difference > 86400) // clamp to a reasonable range
            difference = 60;

        log('Next shuffle due ' + difference + ' seconds from now');
        this._restartShuffleTimeout(difference);
    }

    // convert longdate format into human friendly format
    _localeDate(longdate, include_time = false) {
        try {
            let date = Utils.dateFromLongDate(longdate, 300); // date at update
            return date.to_local().format('%Y-%m-%d' + (include_time? ' %X' : '')); // ISO 8601 - https://xkcd.com/1179/
        }
        catch (e) {
            return 'none';
        }
    }

    // set menu text in lieu of a notification/popup
    _setMenuText() {
        this.titleItem.label.set_text(this.title ? this.title : '');  
        this.copyrightItem.label.set_text(this.copyright ? this.copyright : '');
        if (this._settings.get_boolean('show-count-in-image-title') && this.explanation) {
            let imageList = JSON.parse(this._settings.get_string('bing-json'));
            if (imageList.length > 0)
                this.explainItem.label.set_text( this.explanation + ' [' + (this.imageIndex + 1) + '/' + imageList.length + ']');
        }
        else {
            this.explainItem.label.set_text(this.explanation ? this.explanation : '');
        }
        this._setFavouriteIcon(this.favourite_status?this.ICON_FAVE_BUTTON:this.ICON_UNFAVE_BUTTON);
    }

    _wrapLabelItem(menuItem) {
        let clutter_text = menuItem.label.get_clutter_text();
        clutter_text.set_line_wrap(true);
        clutter_text.set_ellipsize(0);
        clutter_text.set_max_length(0);
        menuItem.label.set_style('max-width: 420px;');
    }

    _setControls() {
        this.favouriteBtn = this._newMenuIcon(
            this.favourite_status?this.ICON_FAVE_BUTTON:this.ICON_UNFAVE_BUTTON,
            this.controlItem, 
            this._favouriteImage);
        this.prevBtn = this._newMenuIcon(
            ICON_PREVIOUS_BUTTON, 
            this.controlItem, 
            this._prevImage);
        this.nextBtn = this._newMenuIcon(
            ICON_NEXT_BUTTON, 
            this.controlItem, 
            this._nextImage);
        this.curBtn = this._newMenuIcon(
            ICON_CURRENT_BUTTON, 
            this.controlItem, 
            this._curImage);
        this.randomizeBtn = this._newMenuIcon(
            this.ICON_RANDOM,
            this.controlItem, 
            this._shuffleImage,
            null, true);
    }

    _newMenuIcon(icon_name, parent, fn, position = null, arg = null) {
        let gicon = Gio.icon_new_for_string(icon_name);
        let icon = new St.Icon({
            /*icon_name: icon_name,*/
            gicon: gicon,
            style_class: 'popup-menu-icon',
            x_expand: true,
            y_expand: true,
            icon_size: this._settings.get_int('controls-icon-size')
        });

        let iconBtn = new St.Button({
            style_class: 'ci-action-btn',
            can_focus: true,
            child: icon,
            /* x_align: Clutter.ActorAlign.END, // FIXME: errors on GNOME 3.28, default to center is ok */
            x_expand: true,
            y_expand: true
        });

        if (position !== null) {
            parent.insert_child_at_index(iconBtn, position);
        }
        else {
            parent.add_child(iconBtn);
        }
            
        iconBtn.connect('button-press-event', fn.bind(this, arg));
        return iconBtn;
    }

    // set menu thumbnail
    _setThumbnailImage() {
        let pixbuf = this.thumbnail.pixbuf;
        let scale_factor = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        
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

        this.thumbnailItem.hexpand = false;
        this.thumbnailItem.vexpand = false;
        this.thumbnailItem.content = image;
        
        log('scale factor: ' + scale_factor);
        this.thumbnailItem.set_size(480*scale_factor, 270*scale_factor);
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

    _setShuffleToggleState() {
        this.toggleShuffle.setToggleState(this._settings.get_string('selected-image') == 'random');
    }

    _toggleShuffleOnlyFaves() {

    }

    _toggleShuffle() {
        if (this._settings.get_string('selected-image') == 'random') {
            this._settings.set_string('selected-image', 'current');
        }
        else {
            this._settings.set_string('selected-image', 'random');
        }
        this._setShuffleToggleState();
        log('switched mode to ' + this._settings.get_string('selected-image'));
    }

    _favouriteImage() {
        log('favourite image '+this.imageURL+' status was '+this.favourite_status);
        this.favourite_status = !this.favourite_status;
        Utils.setImageFavouriteStatus(this._settings, this.imageURL, this.favourite_status);
        this._setFavouriteIcon(this.favourite_status?this.ICON_FAVE_BUTTON:this.ICON_UNFAVE_BUTTON);
    }

    _setFavouriteIcon(icon_name) {
        let gicon = Gio.icon_new_for_string(icon_name);
        this.favouriteBtn.get_children().forEach( (x, i) => {
            x.set_gicon(gicon);
        });
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
        if (Soup.MAJOR_VERSION >= 3) {
            let url = BingImageURL;
            let params = Utils.BingParams;
            params['mkt'] = ( market != 'auto' ? market : '' );

            let request = Soup.Message.new_from_encoded_form('GET', url, Soup.form_encode_hash(params));
            request.request_headers.append('Accept', 'application/json');

            try {
                this.httpSession.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                    this._processMessageRefresh(message);
                });
            }
            catch(error) {
                log('unable to send libsoup json message '+error);
            }
        }
        else {
            let url = BingImageURL + '?format=js&idx=0&n=8&mbl=1&mkt=' + (market != 'auto' ? market : '');
            let request = Soup.Message.new('GET', url);
            request.request_headers.append('Accept', 'application/json');

            // queue the http request
            try {
                this.httpSession.queue_message(request, (httpSession, message) => {
                    this._processMessageRefresh(message);
                });
            }
            catch (error) {
                log('unable to send libsoup json message '+error);
            }
        }
    }

    _processMessageRefresh(message) {
        const decoder = new TextDecoder();
        try {
            let data = (Soup.MAJOR_VERSION >= 3) ? 
                decoder.decode(this.httpSession.send_and_read_finish(message).get_data()): // Soup3
                message.response_body.data; // Soup 2
            
            log('Recieved ' + data.length + ' bytes');
            this._parseData(data);
            
            if (this.selected_image != 'random')
                this._selectImage();
        }
        catch (error) {
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
            let newImages = Utils.mergeImageLists(this._settings, parsed.images);
            
            if (datamarket != prefmarket && prefmarket != 'auto')
                log('WARNING: Bing returning market data for ' + datamarket + ' rather than selected ' + prefmarket);
            
            Utils.purgeImages(this._settings); // delete older images if enabled
            Utils.cleanupImageList(this._settings);
            
            if (newImages.length > 0 && this._settings.get_boolean('revert-to-current-image')) {
                // user wants to switch to the new image when it arrives
                this._settings.set_string('selected-image', 'current');
            }

            if (this._settings.get_boolean('notify')) {
                if (!this._settings.get_boolean('notify-only-latest')) {
                    // notify all new images
                    newImages.forEach((image, index) => {
                            log('New image to notify: ' + Utils.getImageTitle(image));
                            this._createNotification(image);
                    });
                }
                else {
                    // notify only the most recent image
                    let last = newImages.pop();
                    if (last) {
                        log('New image to notify: ' + Utils.getImageTitle(last));
                        this._createNotification(last);
                    }
                }
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
        let msg = _('Bing Wallpaper of the Day for') + ' ' + this._localeDate(image.fullstartdate);
        let details = Utils.getImageTitle(image);
        let notification = new MessageTray.Notification(source, msg, details);
        notification.setTransient(this._settings.get_boolean('transient'));
        source.showNotification(notification);
    }

    _selectImage(force_shuffle = false) {
        let imageList = Utils.getImageList(this._settings);
        let image = null;
        // special values, 'current' is most recent (default mode), 'random' picks one at random, anything else should be filename
        
        if (this.selected_image == 'random' || force_shuffle) {
            if (this._settings.get_boolean('random-mode-include-only-favourites')) {
                let favImageList = imageList.filter(Utils.isFavourite);
                if (favImageList.length > 0)
                    imageList = favImageList;
                else
                    log('not enough favourites available to shuffle');
            }
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
            let resolution = Utils.getResolution(this._settings, image);
            let BingWallpaperDir = Utils.getWallpaperDir(this._settings);

            // set current image details at extension scope
            this.title = image.copyright.replace(/\s*[\(\（].*?[\)\）]\s*/g, '');
            this.explanation = _('Bing Wallpaper of the Day for') + ' ' + this._localeDate(image.startdate);
            this.copyright = image.copyright.match(/[\(\（]([^)]+)[\)\）]/)[1].replace('\*\*', ''); // Japan locale uses （） rather than ()
            this.longstartdate = image.fullstartdate;
            this.imageinfolink = image.copyrightlink.replace(/^http:\/\//i, 'https://');
            this.imageURL = BingURL + image.urlbase + '_' + resolution + '.jpg'; // generate image url for user's resolution
            this.filename = toFilename(BingWallpaperDir, image.startdate, image.urlbase, resolution);

            if (("favourite" in image) && image.favourite === true ) {
                this.favourite_status = true;
            }
            else {
                this.favourite_status = false;
            }
            
            let file = Gio.file_new_for_path(this.filename);
            let file_exists = file.query_exists(null);
            let file_info = file_exists ? file.query_info ('*', Gio.FileQueryInfoFlags.NONE, null) : 0;

            if (!file_exists || file_info.get_size () == 0) { // file doesn't exist or is empty (probably due to a network error)
                let dir = Gio.file_new_for_path(BingWallpaperDir);
                if (!dir.query_exists(null)) {
                    dir.make_directory_with_parents(null);
                }
                this._downloadImage(this.imageURL, file);
            }
            else {
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
                filename: this.filename, favourite: this.favourite_status};
            let stateJSON = JSON.stringify(state);
            
            log('Storing state as JSON: ' + stateJSON);
            this._settings.set_string('state', stateJSON);
        }
    }

    _reStoreState() {
        try {
            // patch for relative paths, ensures that users running git version don't end up with broken state - see EGO review for version 38 https://extensions.gnome.org/review/30299
            this._settings.set_string('download-folder', this._settings.get_string('download-folder').replace('$HOME', '~'));
            let stateJSON = this._settings.get_string('state');
            let state = JSON.parse(stateJSON);
            let maxLongDate = null;
            
            log('restoring state...');
            maxLongDate = state.maxlongdate ? state.maxlongdate : null;
            this.title = state.title;
            this.explanation = state.explanation;
            this.copyright = state.copyright;
            this.longstartdate = state.longstartdate;
            this.imageinfolink = state.imageinfolink;
            this.imageURL = state.imageURL;
            this.filename = state.filename;
            this._selected_image = this._settings.get_string('selected-image');
            if ("favourite" in state && state.favourite === true) {
                this.favourite_status = true;
            }
            else {
                this.favourite_status = false;
            }
            // update menus and thumbnail
            this._setMenuText();
            this._setBackground();
            
            if (!maxLongDate) {
                this._restartTimeout(60);
                return;
            } 
            
            if (this.selected_image == 'random') {
                this._shuffleImage();
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
            if (Soup.MAJOR_VERSION >= 3) {
                this.httpSession.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                    // request completed
                    this._updatePending = false;
                    this._processFileDownload(message, file);
                });
            }
            else {
                this.httpSession.queue_message(request, (httpSession, message) => {
                    // request completed
                    this._updatePending = false;
                    this._processFileDownload(message, file);
                });
            }

        }
        catch (error) {
            log('error sending libsoup message '+error);
        }
    }

    _processFileDownload(message, file) {      
        try {
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
        catch (error) {
            log('Unable download image '+error);
        }
    }

    // open image in default image view
    _openInSystemViewer() {
        Utils.openInSystemViewer(this.filename);
    }

    // open Bing image information page
    _openImageInfoLink() {
        if (this.imageinfolink)
            Utils.openInSystemViewer(this.imageinfolink, false);
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

export default class BingWallpaperExtension extends Extension {
    enable() {
        bingWallpaperIndicator = new BingWallpaperIndicator(this);
        Main.panel.addToStatusArea(IndicatorName, bingWallpaperIndicator);
    }
    disable() {
        bingWallpaperIndicator.stop();
        bingWallpaperIndicator.destroy();
        bingWallpaperIndicator = null;

        // *** NOTE for EGO reviewers ***
        // blur.js remains active during lockscreen, while the rest of the extension is disabled
        // this code ONLY modifies the background blur effects for the lockscreen no web connectivity
        if (!Main.sessionMode.isLocked) {
            blur._disable(); // disable blur (blur.js) override and cleanup
            blur = null;
        }
    }
}

function toFilename(wallpaperDir, startdate, imageURL, resolution) {
    return wallpaperDir + startdate + '-' + imageURL.replace(/^.*[\\\/]/, '').replace('th?id=OHR.', '') + '_' + resolution + '.jpg';
}

