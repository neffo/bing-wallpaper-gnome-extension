// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2023 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.

import St from 'gi://St';
import Gio from 'gi://Gio';

const CLIPBOARD_TYPE = St.ClipboardType.CLIPBOARD;

export default class BWClipboard {
    constructor() {
        this.clipboard = St.Clipboard.get_default();
    }

    setImage(filename) {
        try {
            let file = Gio.File.new_for_path(filename);
            let [success, image_data] = file.load_contents(null);
            //log('error: '+success);
            if (success)
                this.clipboard.set_content(CLIPBOARD_TYPE, 'image/jpeg', image_data);
        } catch (err) {
            log('unable to set clipboard to data in '+filename);
        }
    }

    setText(text) {
        this.clipboard.set_text(CLIPBOARD_TYPE, text);
    }
};
