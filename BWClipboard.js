// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2021 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.

const Gdk = imports.gi.Gdk;
const Gtk = imports.gi.Gtk;

class BWClipboard {
    constructor() {
        this.display = Gdk.Display.get_default();
        this.clipboard = Gtk.Clipboard.get_default(this.display);
    }

    setImage(pixbuf) {
        this.clipboard.set_image(pixbuf);
    }

    setText(text) {
        this.clipboard.set_text(text, -1);
    }
}
