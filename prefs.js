// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2021 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Lang = imports.lang;

const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;

let settings;

let marketDescription = null;
let icon_image = null;
let lastreq = null;
let provider = new Gtk.CssProvider();

const BingImageURL = Utils.BingImageURL;

function init() {
    settings = Utils.getSettings(Me);
    Convenience.initTranslations("BingWallpaper");
}

function buildPrefsWidget(){
    // Prepare labels and controls
    let buildable = new Gtk.Builder();
    if (Gtk.get_major_version() == 4) { // GTK4 removes some properties, and builder breaks when it sees them
        buildable.add_from_file( Me.dir.get_path() + '/Settings4.ui' );
        /* // CSS not yet used
        provider.load_from_path(Me.dir.get_path() + '/prefs.css'); 
        Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION); */
    }
    else {
        buildable.add_from_file( Me.dir.get_path() + '/Settings.ui' );
    }
    
    let box = buildable.get_object('prefs_widget');

    buildable.get_object('extension_version').set_text(Me.metadata.version.toString());
    buildable.get_object('extension_name').set_text(Me.metadata.name.toString());

    let hideSwitch = buildable.get_object('hide');
    let iconEntry = buildable.get_object('icon');
    let notifySwitch = buildable.get_object('notify');
    let bgSwitch = buildable.get_object('background');
    let lsSwitch = buildable.get_object('lock_screen');
    let fileChooserBtn = buildable.get_object('download_folder');
    let fileChooser = buildable.get_object('file_chooser'); // this should only exist on Gtk4
    let folderOpenBtn = buildable.get_object('button_open_download_folder');
    let marketEntry = buildable.get_object('market');
    let resolutionEntry = buildable.get_object('resolution');
    let historyEntry = buildable.get_object('history');
    let deleteSwitch = buildable.get_object('delete_previous');
    let daysSpin = buildable.get_object('days_after_spinbutton');
    marketDescription = buildable.get_object('market_description');
    icon_image = buildable.get_object('icon_image');
    let overrideSwitch = buildable.get_object('lockscreen_override');
    let strengthEntry = buildable.get_object('entry_strength');
    let brightnessEntry = buildable.get_object('entry_brightness');
    let change_log = buildable.get_object('change_log');

    let buttonGDMdefault = buildable.get_object('button_default_gnome');
    let buttonnoblur = buildable.get_object('button_no_blur');
    let buttonslightblur = buildable.get_object('button_slight_blur');

    // check that these are valid (can be edited through dconf-editor)
    //Utils.validate_market(settings, marketDescription);
    Utils.validate_resolution(settings);
    Utils.validate_icon(settings, icon_image);

    // Indicator & notifications
    settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bing('notify', notifySwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    Utils.icon_list.forEach(function (iconname, index) { // add markets to dropdown list (aka a GtkComboText)
        iconEntry.append(iconname, iconname);
    });
    settings.bind('icon-name', iconEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);

    settings.connect('changed::icon-name', function() {
        Utils.validate_icon(settings, icon_image);
    });
    iconEntry.set_active_id(settings.get_string('icon-name'));

    settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('set-lock-screen', lsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    folderOpenBtn.connect('clicked', function(widget) {
        Utils.openImageFolder(settings);
    });

    //download folder
    if (Gtk.get_major_version() == 4) { // we need to use native file choosers in Gtk4
        fileChooserBtn.set_label(settings.get_string('download-folder'));
        fileChooser.set_current_folder(Gio.File.new_for_path(settings.get_string('download-folder')).get_parent());
        fileChooserBtn.connect('clicked', function(widget) {
            let parent = widget.get_root();
            fileChooser.set_action(Gtk.FileChooserAction.SELECT_FOLDER);
            fileChooser.set_transient_for(parent);
            fileChooser.show();
        });
        fileChooser.connect('response', function(widget, response) {
            if (response !== Gtk.ResponseType.ACCEPT) {
                return;
            }
            let fileURI = native.get_file();
            log("fileChooser returned: "+fileURI);
            fileChooserBtn.set_label(fileURI);
            settings.set_string('download-folder', fileURI);
        });
        // in Gtk 4 instead we use a DropDown, but we need to treat it a bit special
        let market_grid = buildable.get_object('market_grid');
        marketEntry = Gtk.DropDown.new_from_strings(Utils.marketName);
        marketEntry.set_selected(Utils.markets.indexOf(settings.get_string('market')));
        market_grid.attach(marketEntry, 1, 0, 1, 2);
        marketEntry.connect('notify::selected-item', function() {
            let id = marketEntry.get_selected();
            settings.set_string('market',Utils.markets[id]);
            log('dropdown selected '+id+' = '+Utils.markets[id]+" - "+Utils.marketName[id]);
        });
        settings.connect('changed::market', function() {
            Utils.validate_market(settings, marketDescription, lastreq);
            lastreq = GLib.DateTime.new_now_utc();
            marketEntry.set_selected(Utils.markets.indexOf(settings.get_string('market')));
        });
    }
    else { // Gtk 3
        fileChooserBtn.set_filename(settings.get_string('download-folder'));
        log("fileChooser filename/dirname set to '"+fileChooserBtn.get_filename()+"' setting is '"+settings.get_string('download-folder')+"'");
        fileChooserBtn.add_shortcut_folder_uri("file://" + GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)+"/BingWallpaper");
        fileChooserBtn.connect('file-set', function(widget) {
            settings.set_string('download-folder', widget.get_filename());
        });
        Utils.markets.forEach(function (bingmarket, index) { // add markets to dropdown list (aka a GtkComboText)
            marketEntry.append(bingmarket, bingmarket+": "+Utils.marketName[index]);
        });
        //marketEntry.set_active_id(settings.get_string('market')); // set to current

        settings.bind('market', marketEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
        settings.connect('changed::market', function() {
            Utils.validate_market(settings, marketDescription, lastreq);
            lastreq = GLib.DateTime.new_now_utc();
        });
    }

    // Resolution
    Utils.resolutions.forEach(function (res) { // add res to dropdown list (aka a GtkComboText)
        resolutionEntry.append(res, res);
    });
    settings.bind('resolution', resolutionEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::resolution', function() {
        Utils.validate_resolution(settings);
    });

    // History
    let imageList = Utils.getImageList(settings);
    historyEntry.append('current',_('Most recent image'));
    historyEntry.append('random',_('Random image'));
    imageList.forEach(function (image) {
            historyEntry.append(image.urlbase.replace('/th?id=OHR.', ''),Utils.getImageTitle(image));
    });
    settings.bind('selected-image', historyEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::selected-image', function() {
        Utils.validate_imagename(settings);
    });


    settings.bind('delete-previous', deleteSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('previous-days', daysSpin, 'value', Gio.SettingsBindFlags.DEFAULT);

    if (Convenience.currentVersionGreaterEqual("3.36")) {
        // lockscreen and desktop wallpaper are shared in GNOME 3.36+
        lsSwitch.set_sensitive(false);
        buildable.get_object('lock_screen_listboxrow').set_tooltip_text(_("Disabled on current GNOME version"));
        // GDM3 lockscreen blur override
        settings.bind('override-lockscreen-blur', overrideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-strength', strengthEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-brightness', brightnessEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        buttonGDMdefault.connect('clicked',function(widget) {
            Utils.set_blur_preset(settings, Utils.PRESET_GNOME_DEFAULT);
        });
        buttonnoblur.connect('clicked',function(widget) {
            Utils.set_blur_preset(settings, Utils.PRESET_NO_BLUR);
        });
        buttonslightblur.connect('clicked',function(widget) {
            Utils.set_blur_preset(settings, Utils.PRESET_SLIGHT_BLUR);
        });
    } else {
        // older version of GNOME
        buildable.get_object('lockscreen_box').set_tooltip_text(_("Disabled on current GNOME version"));
        overrideSwitch.set_sensitive(false);
        strengthEntry.set_sensitive(false);
        brightnessEntry.set_sensitive(false);
        buttonGDMdefault.set_sensitive(false);
        buttonnoblur.set_sensitive(false);
        buttonslightblur.set_sensitive(false);
    }

    // not required in GTK4 as widgets are displayed by default
    if (Gtk.get_major_version() < 4)
        box.show_all();

    // fetch
    Utils.fetch_change_log(Me.metadata.version.toString(), change_log);
    lastreq = GLib.DateTime.new_now_utc();

    return box;
}

