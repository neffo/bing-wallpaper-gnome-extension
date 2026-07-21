// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2025 Michael Carroll
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
/*import Carousel from './carousel.js';*/

var DESKTOP_SCHEMA = 'org.gnome.desktop.background';

// this is pretty wide because of the size of the gallery
var PREFS_DEFAULT_WIDTH = 750;
var PREFS_DEFAULT_HEIGHT = 750;

export default class BingWallpaperExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        // formally globals
        let settings = this.getSettings(Utils.BING_SCHEMA);
        //let desktop_settings = this.getSettings(Utils.DESKTOP_SCHEMA);

        window.set_default_size(PREFS_DEFAULT_WIDTH, PREFS_DEFAULT_HEIGHT);

        /*let icon_image = null;*/
        let provider = new Gtk.CssProvider();
        provider.load_from_path(this.dir.get_path() + '/ui/prefs.css');
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(),
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        /*let carousel = null;*/
        let httpSession = null;

        let BingLog = (msg) => { // avoids need for globals
            if (settings.get_boolean('debug-logging'))
                console.log("BingWallpaper extension: " + msg); // disable to keep the noise down in journal
        }

        let buildable = new Gtk.Builder();
        // GTK4 removes some properties, and builder breaks when it sees them
        buildable.add_from_file( this.dir.get_path() + '/ui/prefsadw.ui' );

        // adw or gtk objects we'll attach to below
        const settings_page = buildable.get_object('settings_page');
        const hideSwitch = buildable.get_object('hideSwitch');
        const notifySwitch = buildable.get_object('notifySwitch');
        const iconEntry = buildable.get_object('iconEntry');
        const bgSwitch = buildable.get_object('bgSwitch');
        const shuffleSwitch = buildable.get_object('shuffleSwitch');
        const shuffleInterval = buildable.get_object('shuffleInterval');
        const providerEntry = buildable.get_object('providerEntry');
        const marketEntry = buildable.get_object('marketEntry');
        const spotlightModeEntry = buildable.get_object('spotlightModeEntry');
        const spotlightCountryEntry = buildable.get_object('spotlightCountryEntry');
        const spotlightLocaleEntry = buildable.get_object('spotlightLocaleEntry');
        const folderRow = buildable.get_object('folderRow');
        const resolutionEntry = buildable.get_object('resolutionEntry');
        const debugSwitch = buildable.get_object('debug_switch');
        const revertSwitch = buildable.get_object('revert_switch');
        const trash_purge_switch = buildable.get_object('trash_purge_switch');
        const delete_previous_switch = buildable.get_object('delete_previous_switch');
        const delete_previous_adjustment = buildable.get_object('delete_previous_adjustment');
        const always_export_switch = buildable.get_object('always_export_switch');
        const randomIntervalEntry = buildable.get_object('entry_random_interval');
        const debug_page = buildable.get_object('debug_page');
        const json_actionrow = buildable.get_object('json_actionrow');
        const about_page = buildable.get_object('about_page');
        const version_row = buildable.get_object('version_row');
        const change_log = buildable.get_object('change_log');

        window.add(settings_page);
        /*window.add(lockscreen_page);
        window.add(gallery_page);*/
        window.add(debug_page);
        window.add(about_page);

        iconEntry.set_value(1+Utils.icon_list.indexOf(settings.get_string('icon-name')));

        // shuffle intervals
        const shuffleIntervals  = new Gtk.StringList;
        Utils.randomIntervals.forEach((x) => {
            shuffleIntervals.append(_(x.title));
        });

        shuffleInterval.set_model(shuffleIntervals);
        shuffleInterval.set_selected(Utils.randomIntervals.map( e => e.value).indexOf(settings.get_string('random-interval-mode')));

        const providerModel = new Gtk.StringList();
        Utils.providerNames.forEach((providerName) => {
            providerModel.append(providerName);
        });
        providerEntry.set_model(providerModel);
        providerEntry.set_selected(Utils.providerIds.indexOf(Utils.getCurrentProvider(settings)));

        const marketModel = new Gtk.StringList();
        Utils.marketName.forEach((marketName) => {
            marketModel.append(marketName);
        });
        marketEntry.set_model(marketModel);
        marketEntry.set_selected(Utils.markets.indexOf(settings.get_string('market')));

        // add wallpaper folder open and change buttons
        const openBtn = new Gtk.Button( {
            label: _('Open folder'),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        const changeBtn = new Gtk.Button( {
            label: _('Change folder'),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });

        folderRow.add_suffix(openBtn);
        folderRow.add_suffix(changeBtn);

        randomIntervalEntry.set_value(settings.get_int('random-interval'));

        // these buttons either export or import saved JSON data
        const buttonImportData = new Gtk.Button( {
            label: _('Import'),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });
        const buttonExportData = new Gtk.Button( {
            label: _('Export'),
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });

        json_actionrow.add_suffix(buttonImportData);
        json_actionrow.add_suffix(buttonExportData);

        version_row.set_subtitle(this.metadata.version.toString());

        try {
            httpSession = new Soup.Session();
            httpSession.user_agent = 'User-Agent: Mozilla/5.0 (X11; GNOME Shell/' + Config.PACKAGE_VERSION + '; Linux x86_64; +https://github.com/neffo/bing-wallpaper-gnome-extension ) BingWallpaper Gnome Extension/' + this.metadata.version;
        }
        catch (e) {
            BingLog("Error creating httpSession: " + e);
        }
        const icon_image = buildable.get_object('icon_image');
        const app_icon_image = buildable.get_object('app_icon_image');

        // check that these are valid (can be edited through dconf-editor)
        Utils.validate_resolution(settings);
        Utils.validate_icon(settings, this.path, icon_image, app_icon_image);
        Utils.validate_interval(settings);
        Utils.getCurrentProvider(settings);
        Utils.normalizeSpotlightCountry(settings);
        Utils.normalizeSpotlightLocale(settings);

        // Indicator & notifications
        settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('notify', notifySwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.connect('changed::icon-name', () => {
            Utils.validate_icon(settings, this.path, icon_image, app_icon_image);
            iconEntry.set_value(1 + Utils.icon_list.indexOf(settings.get_string('icon-name')));
        });

        iconEntry.connect('output', () => {
            settings.set_string('icon-name', Utils.icon_list[iconEntry.get_value()-1]);
        });

        // connect switches to settings changes
        settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('debug-logging', debugSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('revert-to-current-image', revertSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        //settings.bind('override-unsafe-wayland', unsafeSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('random-interval', randomIntervalEntry, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('trash-deletes-images', trash_purge_switch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('always-export-bing-json', always_export_switch, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('delete-previous', delete_previous_switch, 'active', Gio.SettingsBindFlags.DEFAULT);

        // button opens Nautilus at our image folder
        openBtn.connect('clicked', (widget) => {
            Utils.openWallpaperRootFolder(settings);
        });

        // this is intended for migrating image folders between computers (or even sharing) or backups
        // we export the Bing JSON data to the image directory, so this folder becomes portable
        buttonImportData.connect('clicked', () => {
            Utils.importBingJSON(settings);
        });
        buttonExportData.connect('clicked', () => {
            Utils.exportBingJSON(settings);
        });

        // change wallpaper button
        const dirChooser = new Gtk.FileDialog( {
            accept_label: "Select",
            modal: true,
            title: _("Select wallpaper download folder"),
        });

        changeBtn.connect('clicked', (widget) => {
            dirChooser.set_initial_folder(Gio.File.new_for_path(Utils.getWallpaperRootDir(settings)));
            dirChooser.select_folder(window, null, (self, res) => {
                let new_path = self.select_folder_finish(res).get_uri().replace('file://', '');
                BingLog(new_path);
                Utils.moveImagesToNewFolder(settings, Utils.getWallpaperRootDir(settings), new_path);
                Utils.setWallpaperDir(settings, new_path);
            });

        });

        const updateSourceVisibility = () => {
            let provider = Utils.getCurrentProvider(settings);
            let bingProvider = provider === 'bing';
            marketEntry.set_visible(bingProvider);
            resolutionEntry.set_visible(bingProvider);
            spotlightModeEntry.set_visible(!bingProvider);
            let manualMode = settings.get_string('spotlight-mode') === 'manual';
            spotlightCountryEntry.set_visible(!bingProvider && manualMode);
            spotlightLocaleEntry.set_visible(!bingProvider && manualMode);
        };

        const spotlightModeModel = new Gtk.StringList();
        spotlightModeModel.append(_('Auto'));
        spotlightModeModel.append(_('Manual'));
        spotlightModeEntry.set_model(spotlightModeModel);
        spotlightModeEntry.set_selected(settings.get_string('spotlight-mode') === 'manual' ? 1 : 0);

        spotlightModeEntry.connect('notify::selected', () => {
            let index = spotlightModeEntry.get_selected();
            settings.set_string('spotlight-mode', index === 1 ? 'manual' : 'auto');
        });
        settings.connect('changed::spotlight-mode', () => {
            spotlightModeEntry.set_selected(settings.get_string('spotlight-mode') === 'manual' ? 1 : 0);
            updateSourceVisibility();
            updateSpotlightSubtitle();
        });

        providerEntry.connect('notify::selected', () => {
            let index = providerEntry.get_selected();
            if (index >= 0)
                settings.set_string('provider', Utils.providerIds[index]);
        });
        settings.connect('changed::provider', () => {
            providerEntry.set_selected(Utils.providerIds.indexOf(Utils.getCurrentProvider(settings)));
            updateSourceVisibility();
        });

        marketEntry.connect('notify::selected', () => {
            let index = marketEntry.get_selected();
            if (index >= 0)
                settings.set_string('market', Utils.markets[index]);
        });
        settings.connect('changed::market', () => {
            marketEntry.set_selected(Utils.markets.indexOf(settings.get_string('market')));
        });

        settings.bind('spotlight-country', spotlightCountryEntry, 'text', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('spotlight-locale', spotlightLocaleEntry, 'text', Gio.SettingsBindFlags.DEFAULT);

        const updateSpotlightSubtitle = () => {
            if (settings.get_string('spotlight-mode') === 'auto') {
                let resolvedCountry = Utils.getResolvedSpotlightCountry(settings);
                let resolvedLocale = Utils.getResolvedSpotlightLocale(settings);
                spotlightModeEntry.set_subtitle(_('Auto-detect from system') + ' → ' + resolvedCountry + ' / ' + resolvedLocale);
                spotlightCountryEntry.set_visible(false);
                spotlightLocaleEntry.set_visible(false);
            } else {
                spotlightModeEntry.set_subtitle(_('Manually specify country and locale'));
                spotlightCountryEntry.set_visible(true);
                spotlightLocaleEntry.set_visible(true);
            }
        };

        settings.connect('changed::spotlight-country', () => {
            Utils.normalizeSpotlightCountry(settings);
        });
        settings.connect('changed::spotlight-locale', () => {
            Utils.normalizeSpotlightLocale(settings);
        });
        updateSpotlightSubtitle();
        updateSourceVisibility();

        // Resolution
        const resolutionModel = new Gtk.StringList();
        Utils.resolutions.forEach((res) => { // add res to dropdown list (aka a GtkComboText)
            resolutionModel.append(res);
        });
        resolutionEntry.set_model(resolutionModel);
        resolutionEntry.set_selected(Utils.resolutions.indexOf(settings.get_string('resolution')));
        resolutionEntry.connect('notify::selected', () => {
            let index = resolutionEntry.get_selected();
            if (index >= 0)
                settings.set_string('resolution', Utils.resolutions[index]);
        });

        settings.connect('changed::resolution', () => {
            resolutionEntry.set_selected(Utils.resolutions.indexOf(settings.get_string('resolution')));
        });

        settings.connect('changed::resolution', () => {
            Utils.validate_resolution(settings);
        });

        // shuffle modes
        settings.bind('random-mode-enabled', shuffleSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        /*settings.bind('random-interval-mode', entryShuffleMode, 'active_id', Gio.SettingsBindFlags.DEFAULT);*/

        shuffleInterval.connect('notify::selected', () => {
            let index = shuffleInterval.get_selected();
            if (index >= 0)
                settings.set_string('random-interval-mode', Utils.randomIntervals[index].value);
        });

        settings.connect('changed::random-interval-mode', () => {
            shuffleInterval.set_selected(Utils.randomIntervals.map( e => e.value).indexOf(settings.get_string('random-interval-mode')));
        });

        // fetch change log (on about page)

        if (httpSession)
            Utils.fetch_change_log(this.metadata.version.toString(), change_log, httpSession);
    }
}
