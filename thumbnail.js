// Bing Wallpaper GNOME extension
// Copyright (C) 2017-2023 Michael Carroll
// This extension is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// See the GNU General Public License, version 3 or later for details.

import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';

export default class Thumbnail {
    constructor(filePath) {
        if (!filePath) {
            throw new Error(`need argument ${filePath}`);
        }
        try {
            this.pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(filePath, 480, 270);
            this.srcFile = Gio.File.new_for_path(filePath);
        } catch (err) {
            log('Unable to create thumbnail for corrupt or incomplete file: ' + filePath + ' err: ' + err);
        }
    }
};
