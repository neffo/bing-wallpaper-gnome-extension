const St = imports.gi.St;
const Main = imports.ui.main;
const Shell = imports.gi.Shell;
const Background = imports.ui.background;
const UnlockDialog = imports.ui.unlockDialog.UnlockDialog;
const ExtensionUtils = imports.misc.extensionUtils;
const _createBackground = UnlockDialog.prototype._createBackground;
const _updateBackgroundEffects = UnlockDialog.prototype._updateBackgroundEffects;
const Me = ExtensionUtils.getCurrentExtension();
const Utils = Me.imports.utils;

let shellVersionMinor = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[1]); //FIXME: this needs work will porobably break on newer shell versions
let shellVersionPoint = parseInt(imports.misc.config.PACKAGE_VERSION.split('.')[2]); //FIXME: this needs work will porobably break on newer shell versions

let blur_strength = 2;
let blur_brightness = 55;
let debug = true;

function log(msg) {
    if (debug)
        print("BingWallpaper(Blur) extension: " + msg); // disable to keep the noise down in journal
}

class Blur {
    constructor() {
    }

    // code based on https://github.com/PRATAP-KUMAR/Control_Blur_Effect_On_Lock_Screen
    _do_blur(monitorIndex) {
        if (shellVersionMinor == 36 && shellVersionPoint <= 3) { // GNOME shell 3.36.3 and below (FIXME: this needs work)
            log("Blur:_do_lockscreen_blur() called for shell < 3.36.4");
            let monitor = Main.layoutManager.monitors[monitorIndex];
            let widget = new St.Widget({
                style_class: 'screen-shield-background',
                x: monitor.x,
                y: monitor.y,
                width: monitor.width,
                height: monitor.height,
            });

            let bgManager = new Background.BackgroundManager({
                container: widget,
                monitorIndex,
                controlPosition: false,
            });
            this._bgManagers.push(bgManager);
            this._backgroundGroup.add_child(widget);
            const themeContext = St.ThemeContext.get_for_stage(global.stage);
            log("Blur: blur strength: " + blur_strength +" blur brightness: "+blur_brightness);
            let effect = new Shell.BlurEffect({ brightness: blur_brightness * 0.01, sigma: blur_strength * themeContext.scale_factor });
            this._scaleChangedId = themeContext.connect('notify::scale-factor', () => { effect.sigma = SIGMA_VALUE * themeContext.scale_factor; });
            widget.add_effect(effect);
        }
        else { // GNOME shell 3.36.4 and above
            log("Blur:_do_lockscreen_blur() called for shell >= 3.36.4");
            const themeContext = St.ThemeContext.get_for_stage(global.stage);

            for (const widget of this._backgroundGroup.get_children()) {
                widget.get_effect('blur').set({
                    brightness: blur_brightness * 0.01,
                    sigma: blur_strength * themeContext.scale_factor,
                });
            } 
        }
    }

    set_blur_strength(value) {
        if (value > 100 )
            value = 100;
        if (value < 0 )
            value = 0;
        blur_strength = value;
    }

    set_blur_brightness(value) {
        if (value > 1)
            value = 100;
        if (value < 0 )
            value = 0.0;
        blur_brightness = value;
    }

    _switch(enabled) {
        if (enabled) {
            this._enable();
        }
        else {
            this._disable();
        }
    }

    _enable() {
        log("Blur: _lockscreen_blur_enable() called");
        if (shellVersionMinor >= 36) {
            if (shellVersionPoint <= 3) {
                UnlockDialog.prototype._createBackground = this._do_blur;
            }
            else {
                UnlockDialog.prototype._updateBackgroundEffects = this._do_blur;
            }
        }
        else {
            print("Blur: Shell version too old???");
        }
    }

    _disable() {
        log("Blur: _lockscreen_blur_disable() called");
        if (shellVersionMinor >= 36) {
            if (shellVersionPoint <= 3) {
                UnlockDialog.prototype._createBackground = _createBackground;
            }
            else {
                UnlockDialog.prototype._updateBackgroundEffects = _updateBackgroundEffects;
            }
        }
        else {
            print("Blur: Shell version too old???");
        }
    }

    log(msg) {
        print("Blur: " + msg);
    }
}