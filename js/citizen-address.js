import { supabase } from './supabase-init.js';
import { GEOAPIFY_API_KEY } from './citizen-address-config.js';

export const EAST_BAJAC_BAJAC = 'East Bajac-Bajac';

export const BARANGAYS = [
    'Asinan','Banicain','Barretto','East Bajac-Bajac','East Tapinac','Gordon Heights',
    'Kalaklan','Mabayuan','New Banicain','New Ilalim','New Kababae','New Kalalake',
    'Old Cabalan','Pag-asa','Santa Rita','West Bajac-Bajac','West Tapinac'
];

function getAddressElements() {
    return {
        house: document.getElementById('houseNumber'),
        street: document.getElementById('streetName'),
        barangay: document.getElementById('barangay'),
        city: document.getElementById('cityMunicipality'),
        province: document.getElementById('province'),
        postal: document.getElementById('postalCode')
    };
}

export function fillAddressForm(address = {}) {
    const fields = getAddressElements();
    if (address.houseNumber && fields.house) fields.house.value = address.houseNumber;
    if (address.streetName && fields.street) fields.street.value = address.streetName;
    if (address.barangay && fields.barangay) fields.barangay.value = address.barangay;
    if (address.cityMunicipality && fields.city) fields.city.value = address.cityMunicipality;
    if (address.province && fields.province) fields.province.value = address.province;
    if (address.postalCode && fields.postal) fields.postal.value = address.postalCode;
}

export function readAddressForm() {
    const fields = getAddressElements();
    return {
        houseNumber: fields.house?.value.trim() || null,
        streetName: fields.street?.value.trim() || null,
        barangay: fields.barangay?.value.trim() || null,
        cityMunicipality: fields.city?.value.trim() || null,
        province: fields.province?.value.trim() || null,
        postalCode: fields.postal?.value.trim() || null
    };
}

export async function saveCitizenAddress(userId, address, confirmed = true) {
    const payload = {
        id: userId,
        barangay: address.barangay,
        house_number: address.houseNumber,
        street_name: address.streetName,
        city_municipality: address.cityMunicipality,
        province: address.province,
        postal_code: address.postalCode,
        address_confirmed: confirmed,
        address_confirmed_at: confirmed ? new Date().toISOString() : null
    };

    return supabase.from('users').update(payload).eq('id', userId);
}

export async function reverseGeocode(latitude, longitude) {
    if (!GEOAPIFY_API_KEY.trim()) {
        throw new Error('Address lookup is not configured. Add a Geoapify key in js/citizen-address-config.js.');
    }

    const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
    url.search = new URLSearchParams({
        lat: String(latitude),
        lon: String(longitude),
        format: 'json',
        limit: '1',
        lang: 'en',
        apiKey: GEOAPIFY_API_KEY
    });
    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('Geoapify rejected the configured API key. Check its status and allowed origins.');
        }
        if (response.status === 429) {
            throw new Error('Address lookup limit reached.');
        }
        throw new Error('Address lookup is unavailable.');
    }

    const data = await response.json();
    const result = data.results?.[0];
    if (!result) throw new Error('No address was found for this location.');

    const candidates = [result.suburb, result.district];
    const detectedBarangay = candidates.map(matchBarangay).find(Boolean) || '';

    return {
        houseNumber: result.housenumber || '',
        streetName: result.street || '',
        barangay: detectedBarangay,
        cityMunicipality: getCityMunicipality(result),
        province: getProvince(result),
        postalCode: result.postcode || ''
    };
}

function getCityMunicipality(result) {
    const city = result.city || '';
    if (result.country_code?.toLowerCase() === 'ph' &&
        normalizeAdministrativeName(city) === 'olongapo city') {
        return 'Olongapo';
    }
    return city;
}

function getProvince(result) {
    if (result.country_code?.toLowerCase() === 'ph') {
        const county = result.county || '';
        const city = result.city || '';
        const normalizedCounty = normalizeAdministrativeName(county);
        const normalizedCity = normalizeAdministrativeName(city);
        if (normalizedCity === 'olongapo city' || normalizedCity === 'olongapo') {
            return 'Zambales';
        }
        if (county && normalizedCounty !== normalizedCity && !isRegionName(county)) {
            return county;
        }

        const state = result.state || '';
        return state && !isRegionName(state) ? state : '';
    }
    return result.state || result.county || '';
}

function normalizeAdministrativeName(name) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isRegionName(name) {
    const normalized = normalizeAdministrativeName(name);
    return normalized.includes('central luzon') || normalized.includes('region');
}

function matchBarangay(candidate) {
    if (typeof candidate !== 'string') return '';
    const normalized = candidate
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/^(?:barangay|brgy)\.?\s*/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    return BARANGAYS.find(name => name.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized) || '';
}

export function detectCurrentLocation(onState, { serviceArea = '' } = {}) {
    if (!navigator.geolocation) {
        onState({
            type: 'unavailable',
            message: serviceArea
                ? 'Unable to detect your location. Please retry.'
                : 'Location is unavailable. Enter your address manually.'
        });
        return;
    }

    onState({
        type: 'request',
        message: serviceArea ? 'Detecting your location...' : 'Waiting for permission...'
    });
    navigator.geolocation.getCurrentPosition(
        async position => {
            const { latitude, longitude, accuracy } = position.coords;
            onState({
                type: 'detecting',
                message: serviceArea ? 'Detecting your location...' : 'Detecting location...'
            });
            try {
                if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
                    !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
                    throw new Error('The device did not return valid coordinates.');
                }
                const address = await reverseGeocode(latitude, longitude);
                const reliableForBarangay = Number.isFinite(accuracy) && accuracy <= 250;
                const geocoderBarangay = address.barangay;
                if (!reliableForBarangay) address.barangay = '';
                if (serviceArea) {
                    onState({
                        type: 'detected',
                        address,
                        accuracy,
                        mayBeOutsideServiceArea: Boolean(
                            geocoderBarangay && geocoderBarangay !== serviceArea
                        )
                    });
                    return;
                }

                const missingDetails = [
                    ['houseNumber', 'house/building number'],
                    ['streetName', 'street name'],
                    ['cityMunicipality', 'city/municipality'],
                    ['province', 'province']
                ].filter(([field]) => !address[field]).map(([, label]) => label);
                const accuracyText = Number.isFinite(accuracy)
                    ? ` (±${Math.round(accuracy)} m)`
                    : '';
                const messages = [`Location detected${accuracyText}.`];
                if (missingDetails.length) {
                    messages.push(`Missing: ${missingDetails.join(', ')}. Please complete them.`);
                }
                if (!address.barangay) {
                    messages.push(geocoderBarangay
                        ? 'Suggestion not used; select your barangay.'
                        : 'No exact match; select your barangay.');
                } else {
                    messages.push(`Confirm the barangay suggestion: ${address.barangay}.`);
                }
                if (accuracy > 250) messages.push('GPS accuracy is limited; review the address.');
                onState({
                    type: 'detected',
                    address,
                    accuracy,
                    message: messages.join(' ')
                });
            } catch (error) {
                console.error('Reverse geocoding failed:', error);
                onState({
                    type: 'unavailable',
                    message: serviceArea
                        ? 'Unable to detect your location. Please retry.'
                        : error instanceof Error
                            ? `${error.message} Enter your address manually.`
                            : 'Address lookup failed. Enter your address manually.'
                });
            }
        },
        error => {
            if (error.code === 1) {
                onState({ type: 'denied', message: 'Location access denied. Enter your address manually.' });
            } else if (error.code === 3) {
                onState({
                    type: 'unavailable',
                    message: serviceArea
                        ? 'Unable to detect your location. Please retry.'
                        : 'Location timed out. Try again or enter manually.'
                });
            } else {
                onState({
                    type: 'unavailable',
                    message: serviceArea
                        ? 'Unable to detect your location. Please retry.'
                        : 'Location unavailable. Try again or enter manually.'
                });
            }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: serviceArea ? 0 : 300000 }
    );
}
