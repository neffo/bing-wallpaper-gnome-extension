import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

export const PROVIDER_BING = 'bing';
export const PROVIDER_SPOTLIGHT = 'spotlight';

export const providerIds = [PROVIDER_BING, PROVIDER_SPOTLIGHT];
export const providerNames = ['Bing', 'Windows Spotlight'];

export const BingImageURL = 'https://www.bing.com/HPImageArchive.aspx';
export const BingURL = 'https://www.bing.com';
export const BingParams = { format: 'js', idx: '0', n: '8', mbl: '1', mkt: '' };

const DEFAULT_BING_REFRESH_SECONDS = 24 * 3600;
const DEFAULT_SPOTLIGHT_REFRESH_SECONDS = 6 * 3600;

function decodeMessage(session, message) {
    const decoder = new TextDecoder();
    return (Soup.MAJOR_VERSION >= 3) ?
        decoder.decode(session.send_and_read_finish(message).get_data()) :
        message.response_body.data;
}

function sendRequest(session, request) {
    return new Promise((resolve, reject) => {
        try {
            if (Soup.MAJOR_VERSION >= 3) {
                session.send_and_read_async(request, GLib.PRIORITY_DEFAULT, null, (httpSession, message) => {
                    try {
                        resolve(decodeMessage(httpSession, message));
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            }
            else {
                session.queue_message(request, (httpSession, message) => {
                    try {
                        resolve(decodeMessage(httpSession, message));
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            }
        }
        catch (error) {
            reject(error);
        }
    });
}

function addAcceptJson(request) {
    request.request_headers.append('Accept', 'application/json');
    return request;
}

function computeBingRefreshSeconds(fullstartdate) {
    try {
        let longdate = fullstartdate.toString();
        let refreshDue = GLib.DateTime.new(
            GLib.TimeZone.new_utc(),
            parseInt(longdate.substr(0, 4)),
            parseInt(longdate.substr(4, 2)),
            parseInt(longdate.substr(6, 2)),
            parseInt(longdate.substr(8, 2)),
            parseInt(longdate.substr(10, 2)),
            0
        ).add_seconds(86400).to_local();
        let difference = Math.floor(refreshDue.difference(GLib.DateTime.new_now_local()) / 1000000);
        if (difference < 60 || difference > DEFAULT_BING_REFRESH_SECONDS)
            difference = 60;
        return difference + 300;
    }
    catch (error) {
        return DEFAULT_BING_REFRESH_SECONDS;
    }
}

function firstNonEmpty(...values) {
    for (let value of values) {
        if (typeof value === 'string' && value.trim() !== '')
            return value.trim();
    }
    return '';
}

function toInt(value) {
    let parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function stripMicrosoftEdgePrefix(uri) {
    if (!uri)
        return '';
    return uri.replace(/^microsoft-edge:/i, '');
}

function deriveDimensionsFromUrl(url) {
    let match = url.match(/_(\d+)x(\d+)\.[a-z]+$/i);
    if (!match)
        return [null, null];
    return [toInt(match[1]), toInt(match[2])];
}

function getSpotlightHash(url) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1).substring(0, 24);
}

function buildSpotlightCombinedCopyright(title, credit) {
    if (title && credit)
        return title + ' (' + credit + ')';
    return title || credit || 'Spotlight';
}

function parseBingCredit(copyright) {
    let match = copyright ? copyright.match(/[\(\（]([^)]+)[\)\）]/) : null;
    return match ? match[1].replace('**', '') : '';
}

function normalizeBingImage(image) {
    let title = image.copyright ? image.copyright.replace(/\s*[\(\（].*?[\)\）]\s*/g, '') : '';
    let copyrightText = parseBingCredit(image.copyright || '');
    return {
        ...image,
        provider: PROVIDER_BING,
        title: title,
        copyrightText: copyrightText,
        copyrightlink: image.copyrightlink ? image.copyrightlink.replace(/^http:\/\//i, 'https://') : '',
        directurl: image.directurl || '',
    };
}

function getSpotlightDate(index) {
    return GLib.DateTime.new_now_utc().add_seconds(-(index * 60));
}

function normalizeSpotlightItem(rawItem, index) {
    let inner = JSON.parse(rawItem.item || '{}');
    let ad = inner.ad || {};

    let landscapeAsset = firstNonEmpty(
        ad.landscapeImage?.asset,
        ad.image_fullscreen_001_landscape?.u
    );
    let portraitAsset = firstNonEmpty(
        ad.portraitImage?.asset,
        ad.image_fullscreen_001_portrait?.u
    );
    let imageUrl = landscapeAsset || portraitAsset;
    if (!imageUrl)
        return null;

    let title = firstNonEmpty(
        ad.title,
        ad.title_text?.tx,
        ad.hs2_cta_text?.tx,
        ad.hs1_cta_text?.tx,
        'Spotlight'
    );
    let copyrightText = firstNonEmpty(
        ad.copyright,
        ad.copyright_text?.tx,
        ad.iconHoverText?.split('\r\n')[1] || ''
    );
    let copyrightLink = stripMicrosoftEdgePrefix(firstNonEmpty(
        ad.ctaUri,
        ad.title_destination_url?.u,
        ad.hs2_destination_url?.u,
        ad.hs1_destination_url?.u,
        ad.relatedContent?.[0]?.actionUri,
        ad.relatedHotspots?.[0]?.actionUri
    ));

    let width = toInt(ad.landscapeImage?.width) || toInt(ad.image_fullscreen_001_landscape?.w);
    let height = toInt(ad.landscapeImage?.height) || toInt(ad.image_fullscreen_001_landscape?.h);
    if (!width || !height)
        [width, height] = deriveDimensionsFromUrl(imageUrl);

    let date = getSpotlightDate(index);
    let urlbase = 'spotlight-' + getSpotlightHash(imageUrl);

    return {
        provider: PROVIDER_SPOTLIGHT,
        urlbase: urlbase,
        startdate: date.format('%Y%m%d'),
        fullstartdate: date.format('%Y%m%d%H%M'),
        title: title,
        copyrightText: copyrightText,
        copyright: buildSpotlightCombinedCopyright(title, copyrightText),
        copyrightlink: copyrightLink,
        directurl: imageUrl,
        width: width,
        height: height,
        wp: true,
    };
}

function normalizeSpotlightPayload(raw) {
    let parsed = JSON.parse(raw);
    let items = parsed.batchrsp?.items || [];
    let images = [];

    items.forEach((item, index) => {
        try {
            let normalized = normalizeSpotlightItem(item, index);
            if (normalized)
                images.push(normalized);
        }
        catch (error) {
            // ignore malformed spotlight records and continue
        }
    });

    return {
        images: images,
        refreshSeconds: DEFAULT_SPOTLIGHT_REFRESH_SECONDS,
        market: '',
    };
}

const bingProvider = {
    id: PROVIDER_BING,
    label: 'Bing',
    async fetchMetadata(settings, httpSession) {
        let params = { ...BingParams };
        let market = settings.get_string('market');
        params.mkt = (market !== 'auto') ? market : '';
        if (settings.get_boolean('delete-previous') === true && settings.get_int('previous-days') < 8)
            params.n = '' + settings.get_int('previous-days');

        if (Soup.MAJOR_VERSION >= 3) {
            let request = addAcceptJson(Soup.Message.new_from_encoded_form('GET', BingImageURL, Soup.form_encode_hash(params)));
            return sendRequest(httpSession, request);
        }

        let url = BingImageURL + '?format=js&idx=0&n=' + params.n + '&mbl=1&mkt=' + params.mkt;
        let request = addAcceptJson(Soup.Message.new('GET', url));
        return sendRequest(httpSession, request);
    },
    normalizePayload(raw) {
        let parsed = JSON.parse(raw);
        return {
            images: (parsed.images || []).map(normalizeBingImage),
            refreshSeconds: this.getNextRefreshSeconds(parsed),
            market: parsed.market?.mkt || '',
        };
    },
    getDownloadUrl(image, settings) {
        let resolution = settings.get_string('resolution');
        if (resolution === 'auto' || resolution === '' || image.wp === false)
            resolution = 'UHD';
        return BingURL + image.urlbase + '_' + resolution + '.jpg&qlt=100';
    },
    getNextRefreshSeconds(parsed) {
        if (!parsed.images || parsed.images.length === 0)
            return DEFAULT_BING_REFRESH_SECONDS;
        return computeBingRefreshSeconds(parsed.images[0].fullstartdate);
    },
};

const spotlightProvider = {
    id: PROVIDER_SPOTLIGHT,
    label: 'Windows Spotlight',
    async fetchMetadata(settings, httpSession) {
        let country = settings.get_string('spotlight-country') || 'US';
        let locale = settings.get_string('spotlight-locale') || 'en-US';

        let v4Url = 'https://fd.api.iris.microsoft.com/v4/api/selection?&placement=88000820&bcnt=4&country=' +
            encodeURIComponent(country) + '&locale=' + encodeURIComponent(locale) + '&fmt=json';
        let v4Request = addAcceptJson(Soup.Message.new('GET', v4Url));
        let v4Raw = await sendRequest(httpSession, v4Request);
        let v4Normalized = this.normalizePayload(v4Raw);
        if (v4Normalized.images.length > 0)
            return v4Raw;

        let timestamp = GLib.DateTime.new_now_utc().format_iso8601();
        let v3Url = 'https://arc.msn.com/v3/Delivery/Placement?pid=209567&fmt=json&rafb=0&ua=WindowsShellClient%2F0&cdm=1&disphorzres=9999&dispvertres=9999&lo=80217&pl=' +
            encodeURIComponent(locale) + '&lc=' + encodeURIComponent(locale) + '&ctry=' + encodeURIComponent(country.toLowerCase()) +
            '&time=' + encodeURIComponent(timestamp);
        let v3Request = addAcceptJson(Soup.Message.new('GET', v3Url));
        let v3Raw = await sendRequest(httpSession, v3Request);
        let v3Normalized = this.normalizePayload(v3Raw);
        if (v3Normalized.images.length === 0)
            throw new Error('Spotlight API returned no images');
        return v3Raw;
    },
    normalizePayload(raw) {
        return normalizeSpotlightPayload(raw);
    },
    getDownloadUrl(image) {
        return image.directurl || '';
    },
    getNextRefreshSeconds() {
        return DEFAULT_SPOTLIGHT_REFRESH_SECONDS;
    },
};

export const providers = {
    [PROVIDER_BING]: bingProvider,
    [PROVIDER_SPOTLIGHT]: spotlightProvider,
};

export function getProvider(providerId) {
    return providers[providerId] || providers[PROVIDER_BING];
}

export function getProviderLabel(providerId) {
    return getProvider(providerId).label;
}
