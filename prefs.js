
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;
const Soup = imports.gi.Soup;
const Lang = imports.lang;

let httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(httpSession, new Soup.ProxyResolverDefault());

const Convenience = Me.imports.convenience;
const Gettext = imports.gettext.domain('BingWallpaper');
const _ = Gettext.gettext;

let settings;

let markets = ['ar-XA', 'bg-BG','cs-CZ', 'da-DK', 'de-AT', 'de-CH', 'de-DE', 'el-GR', 'en-AU', 'en-CA', 'en-GB',
'en-ID', 'en-IE', 'en-IN', 'en-MY', 'en-NZ', 'en-PH', 'en-SG', 'en-US', 'en-WW', 'en-XA', 'en-ZA', 'es-AR',
'es-CL', 'es-ES', 'es-MX', 'es-US', 'es-XL', 'et-EE', 'fi-FI', 'fr-BE', 'fr-CA', 'fr-CH', 'fr-FR',
'he-IL', 'hr-HR', 'hu-HU', 'it-IT', 'ja-JP', 'ko-KR', 'lt-LT', 'lv-LV', 'nb-NO', 'nl-BE', 'nl-NL',
'pl-PL', 'pt-BR', 'pt-PT', 'ro-RO', 'ru-RU', 'sk-SK', 'sl-SL', 'sv-SE', 'th-TH', 'tr-TR', 'uk-UA',
'zh-CN', 'zh-HK', 'zh-TW'];
let marketName = [
  "(شبه الجزيرة العربية‎) العربية", "български (България)", "čeština (Česko)", "dansk (Danmark)", "Deutsch (Österreich)",
  "Deutsch (Schweiz)", "Deutsch (Deutschland)", "Ελληνικά (Ελλάδα)", "English (Australia)", "English (Canada)",
  "English (United Kingdom)", "English (Indonesia)", "English (Ireland)", "English (India)", "English (Malaysia)",
  "English (New Zealand)", "English (Philippines)", "English (Singapore)", "English (United States)",
  "English (International)", "English (Arabia)", "English (South Africa)", "español (Argentina)", "español (Chile)",
  "español (España)", "español (México)", "español (Estados Unidos)", "español (Latinoamérica)", "eesti (Eesti)",
  "suomi (Suomi)", "français (Belgique)", "français (Canada)", "français (Suisse)", "français (France)",
  "(עברית (ישראל", "hrvatski (Hrvatska)", "magyar (Magyarország)", "italiano (Italia)", "日本語 (日本)", "한국어(대한민국)",
  "lietuvių (Lietuva)", "latviešu (Latvija)", "norsk bokmål (Norge)", "Nederlands (België)", "Nederlands (Nederland)",
  "polski (Polska)", "português (Brasil)", "português (Portugal)", "română (România)", "русский (Россия)",
  "slovenčina (Slovensko)", "slovenščina (Slovenija)", "svenska (Sverige)", "ไทย (ไทย)", "Türkçe (Türkiye)",
  "українська (Україна)", "中文（中国）", "中文（中國香港特別行政區）", "中文（台灣）"
];

let resolutions = [ 'auto', '1920x1200', '1920x1080', '1366x768', '1280x720', '1024x768', '800x600'];
let marketDescription = null;

const BingImageURL = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mbl=1&mkt=";

function init() {
    settings = Utils.getSettings(Me);
    Convenience.initTranslations("BingWallpaper");
}

function buildPrefsWidget(){

    // Prepare labels and controls
    let buildable = new Gtk.Builder();
    buildable.add_from_file( Me.dir.get_path() + '/Settings.ui' );
    let box = buildable.get_object('prefs_widget');

    buildable.get_object('extension_version').set_text(Me.metadata.version.toString());
    buildable.get_object('extension_name').set_text(Me.metadata.name.toString());

    let hideSwitch = buildable.get_object('hide');
    let bgSwitch = buildable.get_object('background');
    let lsSwitch = buildable.get_object('lock_screen');
    let fileChooser = buildable.get_object('download_folder');
    let marketEntry = buildable.get_object('market');
    let resolutionEntry = buildable.get_object('resolution');
    let deleteSwitch = buildable.get_object('delete_previous');
    let daysSpin = buildable.get_object('days_after_spinbutton');
    marketDescription = buildable.get_object('market_description');

    // previous wallpaper images
    let images=[];
    for(let i = 1; i <= 7; i++) {
        images.push(buildable.get_object('image'+i));
    }

    // check that these are valid (can be edited through dconf-editor)
    validate_market();
    validate_resolution();

    // Indicator
    settings.bind('hide', hideSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    settings.bind('set-background', bgSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('set-lock-screen', lsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);

    //download folder
    fileChooser.set_filename(settings.get_string('download-folder'));
    log("fileChooser filename/dirname set to '"+fileChooser.get_filename()+"' setting is '"+settings.get_string('download-folder')+"'");
    fileChooser.add_shortcut_folder_uri("file://" + GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES)+"/BingWallpaper");
    fileChooser.connect('file-set', function(widget) {
        settings.set_string('download-folder', widget.get_filename());
    });

    // Bing Market (locale/country)

    markets.forEach(function (bingmarket, index) { // add markets to dropdown list (aka a GtkComboText)
        marketEntry.append(bingmarket, bingmarket+": "+marketName[index]);
    })
    //marketEntry.set_active_id(settings.get_string('market')); // set to current

    settings.bind('market', marketEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::market', function() {
        validate_market();
        //marketDescription.label = "Set to "+ marketEntry.active_id + " - " + _("Default is en-US");
    });

    resolutions.forEach(function (res) { // add res to dropdown list (aka a GtkComboText)
        resolutionEntry.append(res, res);
    })

    // Resolution
    settings.bind('resolution', resolutionEntry, 'active_id', Gio.SettingsBindFlags.DEFAULT);
    settings.connect('changed::resolution', function() {
        validate_resolution();
    });

    settings.bind('delete-previous', deleteSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('previous-days', daysSpin, 'value', Gio.SettingsBindFlags.DEFAULT);

    box.show_all();

    return box;
};

function validate_resolution() {
    let resolution = settings.get_string('resolution');
    if (resolution == "" || resolutions.indexOf(resolution) == -1) // if not a valid resolution
        settings.reset('resolution');
}

function validate_market() {
    let market = settings.get_string('market');
    if (market == "" || markets.indexOf(market) == -1 ) // if not a valid market
        settings.reset('market');

    log('Testing : '+BingImageURL);

    let request = Soup.Message.new('GET', BingImageURL+market); // + market
    log("fetching: " + BingImageURL+market);
    marketDescription.set_label(_("Fetching data..."));

    // queue the http request
    httpSession.queue_message(request, Lang.bind(this, function(httpSession, message) {
        if (message.status_code == 200) {
            let data = message.response_body.data;
            log("Recieved "+data.length+" bytes");
            let checkData = JSON.parse(data);
            let checkStatus = checkData['market']['mkt'];
            if (checkStatus == market) {
                marketDescription.set_label('Data OK, '+data.length+' bytes recieved');
            } else {
                marketDescription.set_label(_("Market not available in your region"));
            }
        } else {
            log("Network error occured: "+message.status_code);
            marketDescription.set_label(_("A network error occured")+": "+message.status_code);
        }
    }));
}
