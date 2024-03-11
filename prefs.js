// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2023 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.
// Based on GNOME shell extension NASA APOD by Elia Argentieri https://github.com/Elinvention/gnome-shell-extension-nasa-apod

import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import Adw from 'gi://Adw';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as Config from 'resource:///org/gnome/Shell/Extensions/js/misc/config.js';
import * as Utils from './utils.js';
import Carousel from './carousel.js';

const BingImageURL = Utils.BingImageURL;

var DESKTOP_SCHEMA = 'org.gnome.desktop.background';

var PREFS_DEFAULT_WIDTH = 700;
var PREFS_DEFAULT_HEIGHT = 750;

export default class BingWallpaperExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // formally globals
        let settings = this.getSettings(Utils.BING_SCHEMA);
        //let desktop_settings = this.getSettings(Utils.DESKTOP_SCHEMA);

        window.set_default_size(PREFS_DEFAULT_WIDTH, PREFS_DEFAULT_HEIGHT);

        let icon_image = null;
        let provider = new Gtk.CssProvider();
        provider.load_from_path(this.dir.get_path() + '/ui/prefs.css');
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        let carousel = null;
        let httpSession = null;

        let log = (msg) => { // avoids need for globals
            if (settings.get_boolean('debug-logging'))
                console.log("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
        }
        
        let buildable = new Gtk.Builder();
        // GTK4 removes some properties, and builder breaks when it sees them
        buildable.add_from_file( this.dir.get_path() + '/ui/prefsadw.ui' );

        const settings_page = buildable.get_object('settings_page');
        
        window.add(settings_page);
        
        const ui_group = buildable.get_object('ui_group');
        const hideSwitch = buildable.get_object('hideSwitch');
        const notifySwitch = buildable.get_object('notifySwitch');
        const iconEntry = buildable.get_object('iconEntry');

        const list = new Gtk.StringList();
        Utils.icon_list.forEach((iconname, index) => {
            list.append(iconname, iconname);
        });
        
        iconEntry.set_model(list);
        iconEntry.set_selected(Utils.icon_list.indexOf(settings.get_string('icon-name')));
        

        const wp_group = buildable.get_object('wp_group');
        //settings_page.add(wp_group);

        const shuffleIntervals  = new Gtk.StringList;
        Utils.randomIntervals.forEach((x) => {
            shuffleIntervals.append(_(x.title));
        });

        const bgSwitch = buildable.get_object('bgSwitch');
        const shuffleSwitch = buildable.get_object('shuffleSwitch');
        const shuffleInterval = buildable.get_object('shuffleInterval');
        shuffleInterval.set_model(shuffleIntervals);
        shuffleInterval.set_selected(Utils.randomIntervals.map( e => e.value).indexOf(settings.get_string('random-interval-mode')));

        const dl_group = buildable.get_object('dl_group');
        //settings_page.add(dl_group);

        const folderRow = buildable.get_object('folderRow');

        const openBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'folder-pictures-symbolic',
                        label: _('Open folder'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        const changeBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'folder-download-symbolic',
                        label: _('Change folder'),
                    },),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });

        folderRow.add_suffix(openBtn);
        folderRow.add_suffix(changeBtn);

        /* not sure how to make this work right just yet */
        const folderDialog = buildable.get_object('folderDialog');

        const lockscreen_page = new Adw.PreferencesPage({
            title: _('Lock screen'),
            icon_name: 'applications-system-symbolic',
        });
        window.add(lockscreen_page);
        const ls_group = new Adw.PreferencesGroup({
            title: _('Lockscreen blur'),
            /*description: _('Configure the indicator of the extension'),*/
        });
        lockscreen_page.add(ls_group);
        const overrideSwitch = new Adw.SwitchRow({
            title: _('Dynamic lockscreen blur'),
            subtitle: _('Whether to enable dynamic blur mode on lock screen'),
        });
        const strengthEntry = new Adw.SpinRow({
            title: _('Blur strength'),
            subtitle: _('Blur strength when login prompt is not visible'),
            adjustment: new Gtk.Adjustment({
                    lower: 0,
                    upper: 50,
                    value: settings.get_int('lockscreen-blur-strength'),
                    page_increment: 10,
                    step_increment: 1,
                }),
        });
        const brightnessEntry = new Adw.SpinRow({
            title: _('Wallpaper brightness'),
            subtitle: _('Dim wallpaper when login prompt is not visible'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 50,
                value: settings.get_int('lockscreen-blur-brightness'),
                page_increment: 10,
                step_increment: 1,
            }),
        });

        const blurPresets = new Adw.ActionRow({
            title: _('Presets'),
            /*subtitle: _('Open or change wallpaper downloads folder'),*/
        });
        
        const defaultBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'emblem-default-symbolic',
                        label: _('Default'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        const noBlurBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'emblem-default-symbolic',
                        label: _('No blur, slight dim'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });
        const slightBlurBtn = new Gtk.Button( {
            child: new Adw.ButtonContent({
                        icon_name: 'emblem-default-symbolic',
                        label: _('Slight blur & dim'),
                    },),
            valign: Gtk.Align.CENTER, 
            halign: Gtk.Align.CENTER,
        });

        blurPresets.add_suffix(defaultBtn);
        blurPresets.add_suffix(noBlurBtn);
        blurPresets.add_suffix(slightBlurBtn);

        ls_group.add(overrideSwitch);
        ls_group.add(strengthEntry);
        ls_group.add(brightnessEntry);
        ls_group.add(blurPresets);

        const gallery_page = new Adw.PreferencesPage({
            title: _('Gallery'),
            icon_name: 'document-open-recent-symbolic',
        });
        window.add(gallery_page);

        const debug_page = new Adw.PreferencesPage({
            title: _('Debug'),
            icon_name: 'preferences-other-symbolic',
        });
        window.add(debug_page);

        const about_page = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'user-info-symbolic',
        });
        window.add(about_page);



        /*
        // Prepare labels and controls
        let buildable = new Gtk.Builder();
        // GTK4 removes some properties, and builder breaks when it sees them
        buildable.add_from_file( this.dir.get_path() + '/ui/Settings4.ui' );
        */

        
        /*
        let box = buildable.get_object('prefs_widget');

        // fix size of prefs window in GNOME shell 40+ (but super racy, so is unreliable)

        buildable.get_object('extension_version').set_text(this.metadata.version.toString());
        buildable.get_object('extension_name').set_text(this.metadata.name.toString());

        // assign variables to UI objects we've loaded
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
        let switchEnableShuffle = buildable.get_object('shuffle_enabled_switch');
        let entryShuffleMode = buildable.get_object('shuffle_mode_combo');
        let carouselFlowBox = (Gtk.get_major_version() == 4) ? buildable.get_object('carouselFlowBox'): null;
        */

        try {
            httpSession = new Soup.Session();
            httpSession.user_agent = 'User-Agent: Mozilla/5.0 (X11; GNOME Shell/' + Config.PACKAGE_VERSION + '; Linux x86_64; +https://github.com/neffo/bing-wallpaper-gnome-extension ) BingWallpaper Gnome Extension/' + this.metadata.version;
        }
        catch (e) {
            log("Error creating httpSession: " + e);
        }
        
        
        
        // check that these are valid (can be edited through dconf-editor)
        Utils.validate_resolution(settings);
        Utils.validate_icon(settings, this.path, icon_image);
        Utils.validate_interval(settings);

        // Indicator & notifications
        settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('notify', notifySwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        /*
        // add markets to dropdown list (aka a GtkComboText)
        Utils.icon_list.forEach((iconname, index) => {
            iconEntry.append(iconname, iconname);
        });
        */
        // user selectable indicator icons
        // settings.bind('icon-name', iconEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
        settings.connect('changed::icon-name', () => {
            Utils.validate_icon(settings, this.path, icon_image);
            /*iconEntry.set_selected(Utils.indexOf(settings.get_string('icon-name')));*/
        });
        
        /*
        iconEntry.connect('changed', (widget) => {
            settings.set_string('icon-name', Utils.icon_list[iconEntry.active_id]);
        });*/
        
        //iconEntry.set_active_id(settings.get_string('icon-name'));

        // connect switches to settings changes
        settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        /*
        settings.bind('debug-logging', debugSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('revert-to-current-image', revertSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('override-unsafe-wayland', unsafeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('random-interval', randomIntervalEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('always-export-bing-json', switchAlwaysExport, 'active', Gio.SettingsBindFlags.DEFAULT);

        */
        // button opens Nautilus at our image folder
        openBtn.connect('clicked', (widget) => {
            Utils.openImageFolder(settings);
        });
        /*
        // we populate the tab (gtk4+, gnome 40+), this was previously a button to open a new window in gtk3
        carousel = new Carousel(settings, null, null, carouselFlowBox, this.dir.get_path()); // auto load carousel

        // this is intended for migrating image folders between computers (or even sharing) or backups
        // we export the Bing JSON data to the image directory, so this folder becomes portable
        buttonImportData.connect('clicked', () => {
            Utils.importBingJSON(settings);
        });
        buttonExportData.connect('clicked', () => {
            Utils.exportBingJSON(settings);
        });

        //download folder
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
        });

        settings.connect('changed::market', () => {
            marketEntry.set_selected(Utils.markets.indexOf(settings.get_string('market')));
        });

        settings.connect('changed::download-folder', () => {
            fileChooserBtn.set_label(Utils.getWallpaperDir(settings));
        });


        // Resolution
        Utils.resolutions.forEach((res) => { // add res to dropdown list (aka a GtkComboText)
            resolutionEntry.append(res, res);
        });
        
        settings.bind('resolution', resolutionEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);

        settings.connect('changed::resolution', () => {
            Utils.validate_resolution(settings);
        });
        */

        // shuffle modes
        settings.bind('random-mode-enabled', shuffleSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        /*settings.bind('random-interval-mode', entryShuffleMode, 'active_id', Gio.SettingsBindFlags.DEFAULT);*/

        settings.connect('changed::random-interval-mode', () => {
            shuffleInterval.set_selected(Utils.randomIntervals.map( e => e.value).indexOf(settings.get_string('random-interval-mode')));
        });

            
        // GDM3 lockscreen blur override
        settings.bind('override-lockscreen-blur', overrideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-strength', strengthEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('lockscreen-blur-brightness', brightnessEntry, 'value', Gio.SettingsBindFlags.DEFAULT);

        
        // add a couple of preset buttons
        defaultBtn.connect('clicked', (widget) => {
            Utils.set_blur_preset(settings, Utils.PRESET_GNOME_DEFAULT);
        });
        noBlurBtn.connect('clicked', (widget) => {
            Utils.set_blur_preset(settings, Utils.PRESET_NO_BLUR);
        });
        slightBlurBtn.connect('clicked', (widget) => {
            Utils.set_blur_preset(settings, Utils.PRESET_SLIGHT_BLUR);
        });
        
        // fetch
        /*
        if (httpSession)
            Utils.fetch_change_log(this.metadata.version.toString(), change_log, httpSession);
        */

        /*group.add(box);
        page.add(group);

        window.add(page);*/
    }
}
