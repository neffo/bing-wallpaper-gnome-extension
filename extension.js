
const St = imports.gi.St;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const Soup = imports.gi.Soup
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

const BingImageURL = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1"+"&mkt=";
const BingURL = "https://bing.com";
const IndicatorName = "BingWallpaperIndicator";
const TIMEOUT_SECONDS = 24 * 3600; // FIXME: this should use the end data from the json data
const TIMEOUT_SECONDS_ON_HTTP_ERROR = 1 * 3600; // retry in on-hour if there is a http error
const ICON = "bing"

let monitors;
let validresolutions = [ '800x600' , '1024x768', '1280x720', '1280x768', '1366x768', '1920x1080', '1920x1200'];
let aspectratios = [ -1, 1.33, -1, 1.67, 1.78, 1.78, 1.6]; // width / height (ignore the lower res equivalents)
let monitorW; // largest (in pixels) monitor width
let monitorH; // largest (in pixels) monitor height
let autores; // automatically selected resolution

let bingWallpaperIndicator=null;


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

const LongNotification = new Lang.Class({
    Name: 'LongNotification',
    Extends: MessageTray.Notification,

    createBanner: function() {
        // Explanations are usually longer than default
        let banner = this.source.createBanner(this);
        banner.setExpandedLines(20);
        return banner;
    }
});

function notify(msg, details, transient) {
    // set notifications icon
    let source = new MessageTray.Source("BingWallpaper", ICON);
    // force expanded notification
    source.policy = new MessageTray.NotificationPolicy({ enable: true,
                                        enableSound: false,
                                        showBanners: true,
                                        forceExpanded: true,
                                        showInLockScreen: true,
                                        detailsInLockScreen: true
                                      });
    Main.messageTray.add(source);
    let notification = new LongNotification(source, msg, details);
    notification.setTransient(transient);
    // Add action to open Bing website with default browser
    notification.addAction("Bing website", Lang.bind(this, function() {
        Util.spawn(["xdg-open", BingURL]);
    }));
    source.notify(notification);
}

function notifyError(msg) {
    Main.notifyError("BingWallpaper extension error", msg);
}

function doSetBackground(uri, schema) {
    let gsettings = new Gio.Settings({schema: schema});
    gsettings.set_string('picture-uri', uri);
    Gio.Settings.sync();
    gsettings.apply();
}

let httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());

const BingWallpaperIndicator = new Lang.Class({
    Name: IndicatorName,
    Extends: PanelMenu.Button,

    _init: function() {
        this.parent(0.0, IndicatorName);

        this.icon = new St.Icon({icon_name: ICON, style_class: 'system-status-icon'});
        this.actor.add_child(this.icon);

        this.title = "";
        this.explanation = "";
        this.filename = "";
        this.copyright = "";
        this.version = "0.1";
        this._updatePending = false;
        this._timeout = null;

        this._settings = Utils.getSettings();
        this._settings.connect('changed::hide', Lang.bind(this, function() {
            this.actor.visible = !this._settings.get_boolean('hide');
        }));

        this.actor.visible = !this._settings.get_boolean('hide');

        this.showItem = new PopupMenu.PopupMenuItem("Show description");
        this.wallpaperItem = new PopupMenu.PopupMenuItem("Set wallpaper");
        this.refreshItem = new PopupMenu.PopupMenuItem("Refresh");
        this.settingsItem = new PopupMenu.PopupMenuItem("Settings");
        this.menu.addMenuItem(this.showItem);
        this.menu.addMenuItem(this.wallpaperItem);
        this.menu.addMenuItem(this.refreshItem);
        this.menu.addMenuItem(this.settingsItem);
        this.showItem.connect('activate', Lang.bind(this, this._showDescription));
        this.wallpaperItem.connect('activate', Lang.bind(this, this._setBackground));
        this.refreshItem.connect('activate', Lang.bind(this, this._refresh));
        this.settingsItem.connect('activate', function() {
            Util.spawn(["gnome-shell-extension-prefs", Me.metadata.uuid]);
        });

        this.actor.connect('button-press-event', Lang.bind(this, function () {
            // Grey out menu items if an update is pending
            this.refreshItem.setSensitive(!this._updatePending);
            this.showItem.setSensitive(!this._updatePending && this.title != "" && this.explanation != "");
            this.wallpaperItem.setSensitive(!this._updatePending && this.filename != "");
        }));
        this._restartTimeout(60); // wait 60 seconds before performing refresh
    },

    _setBackground: function() {
        if (this.filename == "")
            return;
        if (this._settings.get_boolean('set-background'))
            doSetBackground(this.filename, 'org.gnome.desktop.background');
        if (this._settings.get_boolean('set-lock-screen'))
            doSetBackground(this.filename, 'org.gnome.desktop.screensaver');
    },

    _restartTimeout: function(seconds = null) {
        if (this._timeout)
            Mainloop.source_remove(this._timeout);
        if (seconds == null)
            seconds = TIMEOUT_SECONDS;
        this._timeout = Mainloop.timeout_add_seconds(seconds, Lang.bind(this, this._refresh));
        log('next check in '+seconds+' seconds');
    },

    _showDescription: function() {
        if (this.title == "" && this.explanation == "") {
            this._refresh();
        } else {
            let message = this.explanation;
            if (this.copyright != "")
                message += "\n" + this.copyright + ""
            notify(this.title, message, this._settings.get_boolean('transient'));
        }
    },

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

    _parseData: function(data) {
        let parsed = JSON.parse(data);
        let imagejson = parsed['images'][0];

        if (imagejson['wp'] == true) {
            this.title = imagejson['copyright'].replace(/\s*\(.*?\)\s*/g, "");
            this.explanation = "Bing Wallpaper of the Day for "+imagejson['startdate']+"";
            this.copyright = imagejson['copyright'].match(/\(([^)]+)\)/)[1].replace('\*\*','');;
            let resolution = this._settings.get_string('resolution');

            if (resolution == "auto") {
                log("auto resolution selected ("+autores+")");
                resolution = autores;
            }
            
            if (validresolutions.indexOf(resolution) == -1) { // is resolution valid
                resolution = "1920x1080"; // changed to this resolution by default to avoid the Bing logo
            }

            let url = BingURL+imagejson['url'].replace('1920x1080',resolution); // mangle url to user's resolution

            let BingWallpaperDir = this._settings.get_string('download-folder');
            if (BingWallpaperDir == "")
                BingWallpaperDir = GLib.get_home_dir() + "/Pictures/BingWallpaper/";
            else if (!BingWallpaperDir.endsWith('/'))
                BingWallpaperDir += '/';
            
            this.filename = BingWallpaperDir+imagejson['startdate']+'-'+url.replace(/^.*[\\\/]/, '');
            let file = Gio.file_new_for_path(this.filename);
            let file_exists = file.query_exists(null);
            let file_info = file_exists ? file.query_info ('*',Gio.FileQueryInfoFlags.NONE,null): 0;

            if (!file_exists || file_info.get_size () == 0) { // file doesn't exist or is empty (probably due to a network error)
                let dir = Gio.file_new_for_path(BingWallpaperDir);
                if (!dir.query_exists(null)) {
                    dir.make_directory_with_parents(null);
                }
                this._download_image(url, file);
            } else {
                log("Image already downloaded");
                this._setBackground();
                this._updatePending = false;
            }
        } else {
            this.title = "No wallpaper available";
            this.explanation = "No picture for today 😞.";
            this.filename = "";
            this._updatePending = false;
            if (this._settings.get_boolean('notify'))
                this._showDescription();
        }
    },

    _download_image: function(url, file) {
        log("Downloading " + url + " to " + file.get_uri())

        // open the Gfile
        let fstream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

        // create an http message
        let request = Soup.Message.new('GET', url);

        // got_headers event
        request.connect('got_headers', Lang.bind(this, function(message){
            log("got_headers");
        }));

        // got_chunk event
        request.connect('got_chunk', Lang.bind(this, function(message, chunk){
            fstream.write(chunk.get_data(), null, chunk.length);
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
                if (this._settings.get_boolean('notify'))
                    this._showDescription();
            } else {
                log("Couldn't fetch image from " + url);
                file.delete(null);
            }
        }));
    },

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
            if (deletepictures) {
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

    stop: function () {
        if (this._timeout)
            Mainloop.source_remove(this._timeout);
        this._timeout = undefined;
        this.menu.removeAll();
    }
});

function init(extensionMeta) {
    let theme = imports.gi.Gtk.IconTheme.get_default();
    theme.append_search_path(extensionMeta.path + "/icons");
}

function enable() {
    bingWallpaperIndicator = new BingWallpaperIndicator();
    Main.panel.addToStatusArea(IndicatorName, bingWallpaperIndicator);
    monitors = Main.layoutManager.monitors; // get list of connected monitors (and sizes)
    let largest = 0;
    for (let monitorIdx in monitors) {
        let monitor = monitors[monitorIdx];
        log("monitor "+monitorIdx+" -> "+monitor.width+" x "+monitor.height);
        if ((monitor.width * monitor.height) > largest) {
            monitorW = monitor.width;
            monitorH = monitor.height;
            largest = monitorW * monitorH;
        }
    }

    log("highest res: "+monitorW+" x "+monitorH);

    autores = monitorW+"x"+monitorH

    if (validresolutions.indexOf(autores) == -1) {
        autores = "1920x1080"; // default to this, as people don't like the Bing logo
        log("unknown resolution, defaulted to "+autores);
    }
    else {
        log("detected best resolution "+autores);
    }
}

function disable() {
    bingWallpaperIndicator.stop();
    bingWallpaperIndicator.destroy();
    bingWallpaperIndicator = null;
}

function add_to_previous_queue (filename) {
    let rawimagelist = bingWallpaperIndicator._settings.get_string('previous');
    let imagelist = rawimagelist.split(',');
    let maxpictures = bingWallpaperIndicator._settings.get_int('previous-days');
    let deletepictures = bingWallpaperIndicator._settings.get_boolean('delete-previous');

    log("Raw: "+ rawimagelist+" count: "+imagelist.length);
    log("Settings: delete:"+(deletepictures?"yes":"no")+" max: "+maxpictures);

    imagelist.push(filename);

    while(imagelist.length > maxpictures+1) {
        var to_delete = imagelist.shift(); // get the first (oldest item from the list)
        log("image: "+to_delete);
        if (deletepictures) {
            var file = Gio.file.file_new_for_path(to_delete);
            if (file.query_exists(null))
                file.delete();
            log("deleted file: "+ to_delete);
        }
    }

    // put it back together and send back to settings
    rawimagelist = imagelist.join();
    bingWallpaperIndicator._settings.set_string('previous', rawimagelist);
    log("wrote back this: "+rawimagelist);
}