// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2021 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

pkg.require({
    'Soup': '2.4'
});

const {Gtk, Gdk, GdkPixbuf, Gio, GLib, Soup} = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;
const Carousel = Me.imports.carousel;

let settings;
let desktop_settings;

let marketDescription = null;
let icon_image = null;
let lastreq = null;
let provider = new Gtk.CssProvider();

let carousel = null;
let httpSession = null;

const BingImageURL = Utils.BingImageURL;

var DESKTOP_SCHEMA = 'org.gnome.desktop.background';

var PREFS_DEFAULT_WIDTH = 650;
var PREFS_DEFAULT_HEIGHT = 650;

function init() {
    ExtensionUtils.initTranslations("BingWallpaper"); // this is now included in ExtensionUtils
}

function buildPrefsWidget() {
    // Prepare labels and controls
    let buildable = new Gtk.Builder();
    if (Gtk.get_major_version() == 4) { // GTK4 removes some properties, and builder breaks when it sees them
        buildable.add_from_file( Me.dir.get_path() + '/ui/Settings4.ui' );
        provider.load_from_path(Me.dir.get_path() + '/ui/prefs.css'); 
        Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
    else {
        buildable.add_from_file( Me.dir.get_path() + '/ui/Settings.ui' );
    }
    
    let box = buildable.get_object('prefs_widget');

    // fix size of prefs window in GNOME shell 40+ (but super racy, so is unreliable)
    
    if (Convenience.currentVersionGreaterEqual('40')) {
        box.connect('realize', () => {
            let window = box.get_root();
            //window.default_width = PREFS_DEFAULT_WIDTH;
            window.default_height = PREFS_DEFAULT_HEIGHT;
        });
    }

    buildable.get_object('extension_version').set_text(Me.metadata.version.toString());
    buildable.get_object('extension_name').set_text(Me.metadata.name.toString());

    let hideSwitch = buildable.get_object('hide');
    let iconEntry = buildable.get_object('icon');
    let notifySwitch = buildable.get_object('notify');
    let bgSwitch = buildable.get_object('background');
    let styleEntry = buildable.get_object('background_style');
    let fileChooserBtn = buildable.get_object('download_folder');
    let fileChooser = buildable.get_object('file_chooser'); // this should only exist on Gtk4
    let folderOpenBtn = buildable.get_object('button_open_download_folder');
    let marketEntry = buildable.get_object('market');
    let resolutionEntry = buildable.get_object('resolution');
    let historyEntry = buildable.get_object('history');
    let galleryButton = buildable.get_object('button_open_gallery');
    let deleteSwitch = buildable.get_object('delete_previous');
    marketDescription = buildable.get_object('market_description');
    icon_image = buildable.get_object('icon_image');
    let overrideSwitch = buildable.get_object('lockscreen_override');
    let strengthEntry = buildable.get_object('entry_strength');
    let brightnessEntry = buildable.get_object('entry_brightness');
    let debugSwitch = buildable.get_object('debug_switch');
    let revertSwitch = buildable.get_object('revert_switch');
    let unsafeSwitch = buildable.get_object('unsafe_switch');
    let randomIntervalEntry = buildable.get_object('entry_random_interval');
    let change_log = buildable.get_object('change_log');

    let buttonGDMdefault = buildable.get_object('button_default_gnome');
    let buttonnoblur = buildable.get_object('button_no_blur');
    let buttonslightblur = buildable.get_object('button_slight_blur');
    let buttonImportData = buildable.get_object('button_json_import');
    let buttonExportData = buildable.get_object('button_json_export');
    let switchAlwaysExport = buildable.get_object('always_export_switch');
    let carouselFlowBox = (Gtk.get_major_version() == 4) ? buildable.get_object('carouselFlowBox'): null;
    
    settings = ExtensionUtils.getSettings(Utils.BING_SCHEMA);
    desktop_settings = ExtensionUtils.getSettings(Utils.DESKTOP_SCHEMA);
    try {
        httpSession = new Soup.Session();
    }
    catch (e) {
        log("Error creating httpSession: " + e);
    }

    // check that these are valid (can be edited through dconf-editor)
    //Utils.validate_market(settings, marketDescription);
    Utils.validate_resolution(settings);
    Utils.validate_icon(settings, icon_image);

    // Indicator & notifications
    settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('notify', notifySwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    Utils.icon_list.forEach((iconname, index) => { // add markets to dropdown list (aka a GtkComboText)
        iconEntry.append(iconname, iconname);
    });
    settings.bind('icon-name', iconEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);

    settings.connect('changed::icon-name', () => {
        Utils.validate_icon(settings, icon_image);
    });
    iconEntry.set_active_id(settings.get_string('icon-name'));

    settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('debug-logging', debugSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('revert-to-current-image', revertSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('override-unsafe-wayland', unsafeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('random-interval', randomIntervalEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('always-export-bing-json', switchAlwaysExport, 'active', Gio.SettingsBindFlags.DEFAULT);

    folderOpenBtn.connect('clicked', (widget) => {
        Utils.openImageFolder(settings);
    });
    if (Gtk.get_major_version() == 4) {
        carousel = new Carousel.Carousel(settings, null, null, carouselFlowBox); // auto load carousel
    }
    else {
        galleryButton.connect('clicked', (widget) => {
            carousel = new Carousel.Carousel(settings, widget, null, carouselFlowBox);
        });
    }
    
    
    buttonImportData.connect('clicked', () => {
        Utils.importBingJSON(settings);
    });
    buttonExportData.connect('clicked', () => {
        Utils.exportBingJSON(settings);
    });

    //download folder
    if (Gtk.get_major_version() == 4) { // we need to use native file choosers in Gtk4
        fileChooserBtn.set_label(Utils.getWallpaperDir(settings));
                
        fileChooserBtn.connect('clicked', (widget) => {
            let parent = widget.get_root();
            let curWallpaperDir = Gio.File.new_for_path(Utils.getWallpaperDir(settings));
            fileChooser.set_current_folder(curWallpaperDir.get_parent());
            fileChooser.set_action(Gtk.FileChooserAction.SELECT_FOLDER);
            fileChooser.set_transient_for(parent);
            fileChooser.set_accept_label(_('Select folder'));
            fileChooser.show();
        });
        fileChooser.connect('response', (widget, response) => {
            if (response !== Gtk.ResponseType.ACCEPT) {
                return;
            }
            let fileURI = fileChooser.get_file().get_path().replace('file://', '');
            log("fileChooser returned: "+fileURI);
            fileChooserBtn.set_label(fileURI);
            Utils.moveImagesToNewFolder(settings, Utils.getWallpaperDir(settings), fileURI);
            Utils.setWallpaperDir(settings, fileURI);
        });
        // in Gtk 4 instead we use a DropDown, but we need to treat it a bit special
        let market_grid = buildable.get_object('market_grid');
        marketEntry = Gtk.DropDown.new_from_strings(Utils.marketName);
        marketEntry.set_selected(Utils.markets.indexOf(settings.get_string('market')));
        market_grid.attach(marketEntry, 1, 0, 1, 2);
        marketEntry.connect('notify::selected-item', () => {
            let id = marketEntry.get_selected();
            settings.set_string('market', Utils.markets[id]);
            log('dropdown selected '+id+' = '+Utils.markets[id]+" - "+Utils.marketName[id]);
        });
        settings.connect('changed::market', () => {
            /*Utils.validate_market(settings, marketDescription, lastreq);
            lastreq = GLib.DateTime.new_now_utc();*/
            marketEntry.set_selected(Utils.markets.indexOf(settings.get_string('market')));
        });
        settings.connect('changed::download-folder', () => {
            fileChooserBtn.set_label(Utils.getWallpaperDir(settings));
        });
    }
    else { // Gtk 3
        fileChooserBtn.set_filename(Utils.getWallpaperDir(settings));
        log("fileChooser filename/dirname set to '"+fileChooserBtn.get_filename()+"' setting is '"+settings.get_string('download-folder')+"'");
        fileChooserBtn.add_shortcut_folder_uri("file://" + GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)+"/BingWallpaper");
        fileChooserBtn.connect('file-set', (widget) => {      
            Utils.moveImagesToNewFolder(settings, settings.get_string('download-folder'), widget.get_filename());
            Utils.setWallpaperDir(settings, widget.get_filename());
        });
        Utils.markets.forEach((bingmarket, index) => { // add markets to dropdown list (aka a GtkComboText)
            marketEntry.append(bingmarket, bingmarket+": "+Utils.marketName[index]);
        });

        settings.bind('market', marketEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
        /*settings.connect('changed::market', () => {
            Utils.validate_market(settings, marketDescription, lastreq);
            lastreq = GLib.DateTime.new_now_utc();
        });*/
        settings.connect('changed::download-folder', () => {
            fileChooserBtn.set_filename(Utils.getWallpaperDir(settings));
        });
    }

    // Resolution
    Utils.resolutions.forEach((res) => { // add res to dropdown list (aka a GtkComboText)
        resolutionEntry.append(res, res);
    });
    settings.bind('resolution', resolutionEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::resolution', () => {
        Utils.validate_resolution(settings);
    });

    // History
    let imageList = Utils.getImageList(settings);
    historyEntry.append('current', _('Most recent image'));
    historyEntry.append('random', _('Random image'));
    imageList.forEach((image) => {
        historyEntry.append(image.urlbase.replace('/th?id=OHR.', ''), Utils.shortenName(Utils.getImageTitle(image), 50));
    });
    settings.bind('selected-image', historyEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::selected-image', () => {
        Utils.validate_imagename(settings);
    });
    
    // background styles (e.g. zoom or span)
    Utils.backgroundStyle.forEach((style) => {
        styleEntry.append(style, style);
    });
    desktop_settings.bind('picture-options', styleEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);

    settings.bind('delete-previous', deleteSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
   
    // GDM3 lockscreen blur override
    settings.bind('override-lockscreen-blur', overrideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('lockscreen-blur-strength', strengthEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('lockscreen-blur-brightness', brightnessEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
    buttonGDMdefault.connect('clicked', (widget) => {
        Utils.set_blur_preset(settings, Utils.PRESET_GNOME_DEFAULT);
    });
    buttonnoblur.connect('clicked', (widget) => {
        Utils.set_blur_preset(settings, Utils.PRESET_NO_BLUR);
    });
    buttonslightblur.connect('clicked', (widget) => {
        Utils.set_blur_preset(settings, Utils.PRESET_SLIGHT_BLUR);
    });

    // not required in GTK4 as widgets are displayed by default
    if (Gtk.get_major_version() < 4)
        box.show_all();

    // fetch
    if (httpSession)
        Utils.fetch_change_log(Me.metadata.version.toString(), change_log, httpSession);
    lastreq = GLib.DateTime.new_now_utc();

    return box;
}

function log(msg) {
    if (settings.get_boolean('debug-logging'))
        print("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
}

