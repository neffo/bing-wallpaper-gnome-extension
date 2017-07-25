#!/bin/bash

glib-compile-schemas schemas/

zip -r BingWallpaper@ineffable-gmail.com.zip *

zip -d BingWallpaper@ineffable-gmail.com.zip screenshot/* screenshot

